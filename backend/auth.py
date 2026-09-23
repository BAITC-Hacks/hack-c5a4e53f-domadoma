from datetime import datetime, timedelta, timezone

import jwt
from pwdlib import PasswordHash

from .errors import AppError


def public_user(user):
    return {key: user[key] for key in ("user_id", "role", "employee_id")}


class Auth:
    def __init__(self, repository, settings):
        self.repository = repository
        self.settings = settings
        self.passwords = PasswordHash.recommended()
        self.dummy_hash = self.passwords.hash("unused-demo-login-timing-value")
        missing = [role for role in ("employee", "hr", "admin") if repository.user(user_id=role) is None]
        if missing:
            password_hash = self.passwords.hash(settings.demo_password)
            repository.seed_users([dict(user_id=role, username=role, password_hash=password_hash, role=role,
                                       employee_id=settings.demo_employee_id if role == "employee" else None) for role in missing])

    def login(self, username, password):
        user = self.repository.user(username=username)
        valid = self.passwords.verify(password, user["password_hash"] if user else self.dummy_hash)
        if not user or not valid:
            raise AppError("invalid_credentials", "Invalid username or password", status=401)
        now = datetime.now(timezone.utc)
        token = jwt.encode({"sub": user["user_id"], "iat": now, "exp": now + timedelta(minutes=self.settings.token_minutes)},
                           self.settings.jwt_secret, algorithm="HS256")
        return {"access_token": token, "token_type": "bearer", "user": public_user(user)}

    def authenticate(self, authorization):
        if not authorization:
            raise AppError("unauthorized", "Bearer token required", status=401)
        scheme, _, token = authorization.partition(" ")
        if scheme.lower() != "bearer" or not token:
            raise AppError("unauthorized", "Bearer token required", status=401)
        try:
            claims = jwt.decode(token, self.settings.jwt_secret, algorithms=["HS256"], options={"require": ["sub", "iat", "exp"]})
        except jwt.InvalidTokenError as exc:
            raise AppError("unauthorized", "Invalid or expired token", status=401) from exc
        user = self.repository.user(user_id=claims["sub"])
        if not user:
            raise AppError("unauthorized", "Account unavailable", status=401)
        return public_user(user)


def require_role(user, *roles):
    if user["role"] not in roles:
        raise AppError("forbidden", "This role cannot perform the operation", status=403)


def require_employee(user, employee_id, *, write=False):
    if user["role"] == "employee":
        if user["employee_id"] != employee_id:
            raise AppError("forbidden", "Only your own employee profile is accessible", status=403)
    else:
        require_role(user, *(('admin',) if write else ('admin', 'hr')))
