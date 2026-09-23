import asyncio
import logging
import sqlite3
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Literal

from fastapi import Depends, FastAPI, File, Header, Query, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from pydantic import ValidationError
from starlette.concurrency import run_in_threadpool
from starlette.exceptions import HTTPException

from .auth import Auth, require_employee, require_role
from .config import Settings
from .errors import AppError
from .integration import EngineDomain
from .loading import parse_employees, parse_history
from .models import HistoryRecord
from .repository import Repository
from .schemas import (
    CompletionRequest, CompletionResponse, EmployeesResponse, HRResponse, ImportResponse,
    LoginRequest, LoginResponse, ProfileResponse, RecommendationResponse, UserResponse,
)


def error_response(code, message, status, details=None):
    return JSONResponse({"error": {"code": code, "message": message, "details": details or []}},
                        status_code=status, headers={"WWW-Authenticate": "Bearer"} if status == 401 else None)


class BodyLimit:
    """Bound the ASGI stream too, including requests without Content-Length."""
    def __init__(self, app, settings):
        self.app, self.settings = app, settings

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] not in ("POST", "PUT", "PATCH"):
            return await self.app(scope, receive, send)
        limit = (2 * self.settings().upload_limit_bytes + 65536) if scope["path"] == "/api/admin/upload" else 16384
        body = bytearray()
        while True:
            event = await receive()
            if event["type"] == "http.disconnect":
                return
            body.extend(event.get("body", b""))
            if len(body) > limit:
                return await error_response("upload_too_large", "Request exceeds size limit", 413)(scope, receive, send)
            if not event.get("more_body", False):
                break
        delivered = False
        async def replay():
            nonlocal delivered
            if not delivered:
                delivered = True
                return {"type": "http.request", "body": bytes(body), "more_body": False}
            return await receive()
        await self.app(scope, replay, send)


class SafeErrors:
    """Catch before ServerErrorMiddleware can re-raise sensitive exceptions."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        started = False
        async def safe_send(message):
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)
        try:
            await self.app(scope, receive, safe_send)
        except Exception:
            # No exception message, stack, headers, body, or employee data.
            logging.getLogger("career_quest").error("Unhandled backend request error")
            if not started:
                await error_response("internal_error", "Internal service error", 500)(scope, receive, send)


def own_history(snap, employee_id):
    marks = [c for c in snap.completions if c["employee_id"] == employee_id]
    replaced = {c["replaces_record_id"] for c in marks if c["replaces_record_id"]}
    rows = [h for h in snap.history if h["employee_id"] == employee_id and h["record_id"] not in replaced]
    rows.extend({key: mark[key] for key in HistoryRecord.model_fields} for mark in marks)
    return [{**h, "title": snap.events[h["event_id"]]["title"]} for h in sorted(rows, key=lambda h: (h["date"], h["record_id"]), reverse=True)]


def create_app(settings=None, *, repository=None, domain=None):
    @asynccontextmanager
    async def lifespan(app):
        app.state.settings = settings or Settings.from_env()
        app.state.repo = repository or Repository(app.state.settings.db_path)
        app.state.repo.seed(app.state.settings.data_dir)
        app.state.auth = Auth(app.state.repo, app.state.settings)
        app.state.domain = domain if domain is not None else EngineDomain()
        yield

    app = FastAPI(title="Career Quest API", version="1.0.0", lifespan=lifespan)
    app.add_middleware(BodyLimit, settings=lambda: app.state.settings)
    app.add_middleware(SafeErrors)

    @app.exception_handler(AppError)
    async def application_error(request, exc):
        return error_response(exc.code, exc.message, exc.status, exc.details)

    @app.exception_handler(RequestValidationError)
    async def request_validation(request, exc):
        # Never reflect Pydantic input/ctx (could contain credentials).
        details = [{"field": ".".join(map(str, e["loc"])), "message": "Invalid or missing value"} for e in exc.errors()]
        return error_response("validation_error", "Request validation failed", 422, details)

    @app.exception_handler(HTTPException)
    async def http_error(request, exc):
        return error_response("not_found" if exc.status_code == 404 else "http_error", "Route not found" if exc.status_code == 404 else "Request rejected", exc.status_code)

    @app.exception_handler(sqlite3.OperationalError)
    async def database_error(request, exc):
        return error_response("database_unavailable", "Database temporarily unavailable", 503)

    def current_user(request: Request, authorization: Annotated[str | None, Header()] = None):
        return request.app.state.auth.authenticate(authorization)

    User = Annotated[dict, Depends(current_user)]

    def admin(user: User):
        require_role(user, "admin")
        return user

    def snapshot_for(employee_id):
        snap = app.state.repo.snapshot()
        if employee_id not in snap.employees:
            raise AppError("not_found", "Employee not found", status=404)
        return snap

    def profile(snap, employee_id):
        value = dict(app.state.domain.analyze(snap, employee_id))
        value["state_revision"] = snap.state_revision
        value["employee"] = {k: snap.employees[employee_id][k] for k in ("employee_id", "full_name", "department", "role", "grade", "preferred_language")}
        value["history"] = own_history(snap, employee_id)
        try:
            return ProfileResponse.model_validate(value)
        except ValidationError as exc:
            raise AppError("engine_contract_error", "Invalid domain profile response", status=502) from exc

    @app.get("/api/health")
    def health():
        return {"status": "ok" if app.state.domain.available else "degraded", "recommendation_module": "available" if app.state.domain.available else "not_integrated"}

    @app.post("/api/auth/login", response_model=LoginResponse)
    def login(body: LoginRequest):
        return app.state.auth.login(body.username, body.password)

    @app.get("/api/auth/me", response_model=UserResponse)
    def me(user: User):
        return user

    @app.get("/api/employees", response_model=EmployeesResponse)
    def employees(user: User):
        require_role(user, "hr", "admin")
        return {"employees": [{k: e[k] for k in ("employee_id", "full_name", "role", "grade")} for e in app.state.repo.snapshot().employees.values()]}

    @app.get("/api/employees/{employee_id}", response_model=ProfileResponse)
    def employee(employee_id: str, user: User):
        require_employee(user, employee_id)
        return profile(snapshot_for(employee_id), employee_id)

    @app.get("/api/employees/{employee_id}/recommendations", response_model=RecommendationResponse)
    async def recommendations(employee_id: str, user: User, lang: Annotated[Literal["ru", "kk", "en"] | None, Query()] = None):
        require_employee(user, employee_id)
        started = time.perf_counter()
        try:
            async with asyncio.timeout(app.state.settings.recommendation_timeout):
                snap = await run_in_threadpool(snapshot_for, employee_id)
                language = lang or snap.employees[employee_id]["preferred_language"]
                result = await app.state.domain.recommend(snap, employee_id, language)
                if await run_in_threadpool(app.state.repo.revision) != snap.state_revision:
                    raise AppError("stale_revision", "State changed during recommendation; request again", status=409)
        except TimeoutError as exc:
            raise AppError("recommendation_timeout", "Recommendation deadline exceeded", status=504) from exc
        try:
            response = RecommendationResponse.model_validate(result)
        except ValidationError as exc:
            raise AppError("engine_contract_error", "Invalid domain recommendation response", status=502) from exc
        if response.employee_id != employee_id or response.state_revision != snap.state_revision or response.language != language:
            raise AppError("engine_contract_error", "Domain response does not match requested snapshot", status=502)
        response.duration_ms = round((time.perf_counter() - started) * 1000, 2)
        return response

    @app.post("/api/employees/{employee_id}/activities/{event_id}/complete", response_model=CompletionResponse)
    def complete(employee_id: str, event_id: str, body: CompletionRequest, user: User,
                 idempotency_key: Annotated[str, Header(min_length=1, max_length=128)]):
        require_employee(user, employee_id, write=True)
        status = app.state.repo.complete(employee_id, event_id, body.occurrence_key, user_id=user["user_id"],
                                         idempotency_key=idempotency_key, validate=app.state.domain.validate_completion)
        return {"status": status, "profile": profile(snapshot_for(employee_id), employee_id)}

    @app.get("/api/hr/overview", response_model=HRResponse)
    def overview(user: User):
        require_role(user, "hr", "admin")
        snap = app.state.repo.snapshot()
        result = dict(app.state.domain.overview(snap))
        result["state_revision"] = snap.state_revision
        try:
            return HRResponse.model_validate(result)
        except ValidationError as exc:
            raise AppError("engine_contract_error", "Invalid HR domain response", status=502) from exc

    @app.post("/api/admin/upload", response_model=ImportResponse)
    async def upload(user: Annotated[dict, Depends(admin)], employees_file: Annotated[UploadFile, File()], history_file: Annotated[UploadFile, File()]):
        limit = app.state.settings.upload_limit_bytes
        employees_bytes = await employees_file.read(limit + 1)
        history_bytes = await history_file.read(limit + 1)
        if len(employees_bytes) > limit or len(history_bytes) > limit:
            raise AppError("upload_too_large", "Each file must fit within the upload limit", status=413)
        def import_files():
            return app.state.repo.import_batch(parse_employees(employees_bytes), parse_history(history_bytes))
        return await run_in_threadpool(import_files)

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        if path == "api" or path.startswith("api/"):
            raise AppError("not_found", "API route not found", status=404)
        root = Path(app.state.settings.static_dir).resolve()
        target = (root / path).resolve()
        if not target.is_relative_to(root):
            raise AppError("not_found", "File not found", status=404)
        if target.is_file():
            return FileResponse(target)
        if Path(path).suffix or not (root / "index.html").is_file():
            raise AppError("not_found", "File not found", status=404)
        return FileResponse(root / "index.html")

    return app


app = create_app()
