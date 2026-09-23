import asyncio
import json
from dataclasses import replace
from pathlib import Path

import jwt
import pytest
from fastapi.testclient import TestClient

from backend.config import Settings
from backend.errors import AppError
from backend.main import create_app
from test_repository import DATA, new_employee, repo


class DomainDouble:
    """API-boundary test double. Does NOT implement readiness or real AI."""
    available = True

    def analyze(self, snap, employee_id):
        e = snap.employees[employee_id]
        return {"employee": {k: e[k] for k in ("employee_id", "full_name", "department", "role", "grade", "preferred_language")},
                "target": {"role": e["role"], "grade": e["grade"], "source": "current_grade"},
                "readiness": {"pct": 0, "critical_met": 0, "critical_total": 0}, "skills": [], "history": [],
                "state_revision": snap.state_revision}

    async def recommend(self, snap, employee_id, language):
        return {"employee_id": employee_id, "language": language, "state_revision": snap.state_revision,
                "source": "fallback", "fallback_reason": "test_double", "leader_override": False, "duration_ms": 0,
                "recommendations": [], "not_chosen": None, "uncovered_critical": [], "empty_reason": "catalog_gap"}

    def validate_completion(self, snap, employee_id, event_id, occurrence_key):
        if event_id == "EV_006":
            raise AppError("missing_prerequisites", "Test domain rejects this activity", status=409)

    def overview(self, snap):
        return {"state_revision": snap.state_revision, "weak_skills": [], "no_recommendation": [], "participation": []}


@pytest.fixture
def settings(repo, tmp_path):
    return Settings(db_path=repo.path, data_dir=DATA, jwt_secret="test-only-secret-" * 4,
                    demo_password="test-password", static_dir=tmp_path / "dist", recommendation_timeout=8)


@pytest.fixture
def client(repo, settings):
    with TestClient(create_app(settings, repository=repo, domain=DomainDouble())) as c:
        yield c


def login(client, role="employee"):
    response = client.post("/api/auth/login", json={"username": role, "password": "test-password"})
    assert response.status_code == 200, response.text
    return {"Authorization": "Bearer " + response.json()["access_token"]}


def test_auth_and_object_scope(client):
    assert client.get("/api/employees/E0002").status_code == 401
    employee = login(client)
    assert client.get("/api/auth/me", headers=employee).json()["employee_id"] == "E0002"
    assert client.get("/api/employees/E0002", headers=employee).status_code == 200
    for path in ("/api/employees/E0001", "/api/employees/E0001/recommendations", "/api/employees", "/api/hr/overview"):
        assert client.get(path, headers=employee).status_code == 403
    employee["X-Role"] = "admin"
    assert client.get("/api/employees", headers=employee).status_code == 403
    assert client.post("/api/admin/upload", headers=employee).status_code == 403
    hr = login(client, "hr")
    assert client.get("/api/employees", headers=hr).status_code == 200
    assert client.get("/api/hr/overview", headers=hr).status_code == 200
    assert client.post("/api/employees/E0002/activities/EV_005/complete", headers={**hr, "Idempotency-Key": "hr-test"}, json={"occurrence_key": None}).status_code == 403


def test_invalid_and_expired_tokens(client, settings):
    for claims in ({"sub": "employee", "exp": 1, "iat": 0}, {"sub": "missing", "exp": 9999999999, "iat": 0}):
        token = jwt.encode(claims, settings.jwt_secret, algorithm="HS256")
        assert client.get("/api/auth/me", headers={"Authorization": "Bearer " + token}).status_code == 401
    assert client.get("/api/auth/me", headers={"Authorization": "Bearer nonsense"}).status_code == 401


def test_error_envelope_and_secret_redaction(client):
    for response in (
        client.get("/api/missing"), client.get("/api"),
        client.post("/api/auth/login", json={"username": "admin", "password": {"secret": "do-not-reflect"}}),
        client.post("/api/auth/login", json={"username": "admin", "password": "do-not-reflect"}),
    ):
        assert set(response.json()) == {"error"}
        assert isinstance(response.json()["error"]["details"], list)
        assert "do-not-reflect" not in response.text


def test_upload_preview_dedup_and_rollback(client, repo):
    headers = login(client, "admin")
    employee = new_employee(repo)
    csv_header = (DATA / "activity_history.csv").read_text(encoding="utf-8-sig").splitlines()[0] + "\n"
    files = {"employees_file": ("employees.json", json.dumps(employee).encode()), "history_file": ("history.csv", csv_header.encode())}
    response = client.post("/api/admin/upload", headers=headers, files=files)
    assert response.status_code == 200, response.text
    assert response.json()["employee_ids"] == ["TEST_001"]
    assert client.get("/api/employees/TEST_001", headers=headers).status_code == 200
    employee["employee_id"] = "TEST_BAD"
    files["employees_file"] = ("employees.json", json.dumps(employee).encode())
    files["history_file"] = ("history.csv", b"bad,column\na,b\n")
    assert client.post("/api/admin/upload", headers=headers, files=files).status_code == 422
    assert "TEST_BAD" not in repo.snapshot().employees


def test_completion_idempotency_and_baseline(client, repo):
    headers = {**login(client), "Idempotency-Key": "click-1"}
    url = "/api/employees/E0002/activities/EV_005/complete"
    before = repo.snapshot().employees["E0002"]
    first = client.post(url, headers=headers, json={"occurrence_key": None})
    assert first.status_code == 200, first.text
    assert first.json()["status"] == "completed"
    revision = first.json()["profile"]["state_revision"]
    for key in ("click-1", "click-2"):
        response = client.post(url, headers={**headers, "Idempotency-Key": key}, json={"occurrence_key": None})
        assert response.json()["status"] == "already_completed"
        assert response.json()["profile"]["state_revision"] == revision
    snap = repo.snapshot()
    assert snap.employees["E0002"] == before
    assert len(snap.completions) == 1
    assert snap.completions[0]["date"] == "2026-10-01"
    response = client.post(url.replace("EV_005", "EV_006"), headers=headers, json={"occurrence_key": None})
    assert response.status_code == 409


def test_domain_rejection_no_mutation(client, repo):
    response = client.post("/api/employees/E0002/activities/EV_006/complete", headers={**login(client), "Idempotency-Key": "blocked"}, json={"occurrence_key": None})
    assert response.status_code == 409
    assert repo.revision() == 1
    assert repo.snapshot().completions == []


def test_recommendations_language_timeout_and_stale(repo, settings):
    class Slow(DomainDouble):
        async def recommend(self, *args):
            await asyncio.sleep(1)
    with TestClient(create_app(replace(settings, recommendation_timeout=0.2), repository=repo, domain=Slow())) as client:
        headers = login(client)
        assert client.get("/api/employees/E0002/recommendations", headers=headers).status_code == 504
    class Stale(DomainDouble):
        async def recommend(self, *args):
            with repo.connection(write=True) as db:
                repo.bump(db)
            return await super().recommend(*args)
    with TestClient(create_app(settings, repository=repo, domain=Stale())) as client:
        assert client.get("/api/employees/E0002/recommendations", headers=login(client)).status_code == 409
    with TestClient(create_app(settings, repository=repo, domain=DomainDouble())) as client:
        assert client.get("/api/employees/E0002/recommendations?lang=kk", headers=login(client)).json()["language"] == "kk"


def test_missing_ai_is_explicit_and_complete_does_not_write(repo, settings):
    from backend.integration import EngineDomain
    domain = EngineDomain()
    domain.available = False
    with TestClient(create_app(settings, repository=repo, domain=domain)) as client:
        headers = login(client)
        assert client.get("/api/health").json()["status"] == "degraded"
        assert client.get("/api/employees/E0002", headers=headers).status_code == 503
        response = client.post("/api/employees/E0002/activities/EV_005/complete", headers={**headers, "Idempotency-Key": "missing-ai"}, json={"occurrence_key": None})
        assert response.status_code == 503
        assert repo.revision() == 1


def test_upload_size_limit_and_spa_isolation(repo, settings):
    settings.static_dir.mkdir()
    (settings.static_dir / "index.html").write_text("<html>SPA</html>", encoding="utf-8")
    with TestClient(create_app(replace(settings, upload_limit_bytes=100), repository=repo, domain=DomainDouble())) as client:
        assert client.get("/profile").status_code == 200
        assert client.get("/api/unknown").status_code == 404
        assert client.get("/api/unknown").headers["content-type"].startswith("application/json")
        assert client.get("/runtime/career_quest.sqlite3").status_code == 404
        assert client.get("/data/employees.json").status_code == 404
        files = {"employees_file": ("e.json", b"x" * 101), "history_file": ("h.csv", b"")}
        assert client.post("/api/admin/upload", headers=login(client, "admin"), files=files).status_code == 413
        assert client.post("/api/admin/upload", content=b"x" * 66000).status_code == 413


def test_generic_exception_redacted(repo, settings):
    class Broken(DomainDouble):
        def analyze(self, *args):
            raise RuntimeError("fake-private-api-key")
    # Must not propagate to Uvicorn (which would log the secret in traceback).
    with TestClient(create_app(settings, repository=repo, domain=Broken())) as client:
        response = client.get("/api/employees/E0002", headers=login(client))
        assert response.status_code == 500
        assert "fake-private-api-key" not in response.text


def test_bad_history_reports_file_row_and_field(client):
    header = (DATA / "activity_history.csv").read_text(encoding="utf-8-sig").splitlines()[0]
    row = "BAD,E0002,EV_005,2026-09-01,,completed,not-a-number,,,self\n"
    response = client.post("/api/admin/upload", headers=login(client, "admin"), files={
        "employees_file": ("e.json", b"[]"), "history_file": ("h.csv", (header + "\n" + row).encode())})
    assert response.status_code == 422
    assert response.json()["error"]["details"][0] == {"file": "history_file", "row": 2, "field": "completion_pct", "message": "Expected integer"}
