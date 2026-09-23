import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    jwt_secret: str
    demo_password: str
    db_path: Path = Path("runtime/career_quest.sqlite3")
    data_dir: Path = Path("data")
    static_dir: Path = Path("frontend/dist")
    demo_employee_id: str = "E0002"
    token_minutes: int = 30
    upload_limit_bytes: int = 5 * 1024 * 1024
    recommendation_timeout: float = 8.0

    def __post_init__(self):
        if len(self.jwt_secret.encode()) < 32:
            raise ValueError("JWT_SECRET must contain at least 32 bytes")
        if len(self.demo_password) < 8:
            raise ValueError("DEMO_PASSWORD must contain at least 8 characters")
        if not 1 <= self.token_minutes <= 60 or self.upload_limit_bytes <= 0 or self.recommendation_timeout <= 0:
            raise ValueError("Invalid service limits")

    @classmethod
    def from_env(cls):
        return cls(jwt_secret=os.environ.get("JWT_SECRET", ""), demo_password=os.environ.get("DEMO_PASSWORD", ""),
                   db_path=Path(os.getenv("DB_PATH", "runtime/career_quest.sqlite3")),
                   data_dir=Path(os.getenv("DATA_DIR", "data")), static_dir=Path(os.getenv("STATIC_DIR", "frontend/dist")),
                   demo_employee_id=os.getenv("DEMO_EMPLOYEE_ID", "E0002"))
