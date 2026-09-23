"""SQLite is authoritative. Snapshots are detached, transaction-consistent values."""
import json
import sqlite3
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path
from uuid import uuid4

from .errors import AppError
from .loading import indexed, load_directory, validate_relations
from .models import Employee, Event, HistoryRecord, RoleProfile, Skill


def encoded(value):
    if hasattr(value, "model_dump"):
        value = value.model_dump(mode="json")
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


@dataclass(frozen=True)
class Snapshot:
    skills: dict
    profiles: dict
    employees: dict
    events: dict
    history: list
    completions: list
    employee_versions: dict
    as_of: date
    state_revision: int


class Repository:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connection() as db:
            db.executescript("""
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS employees (id TEXT PRIMARY KEY, body TEXT NOT NULL, version INTEGER NOT NULL);
                CREATE TABLE IF NOT EXISTS skills (id TEXT PRIMARY KEY, body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS profiles (role TEXT, grade TEXT, body TEXT NOT NULL, PRIMARY KEY(role,grade));
                CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS history (id TEXT PRIMARY KEY, body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS completions (
                    employee_id TEXT, event_id TEXT, occurrence TEXT, body TEXT NOT NULL,
                    PRIMARY KEY(employee_id,event_id,occurrence));
                CREATE TABLE IF NOT EXISTS operations (
                    user_id TEXT, key TEXT, fingerprint TEXT NOT NULL,
                    PRIMARY KEY(user_id,key));
                CREATE TABLE IF NOT EXISTS users (
                    user_id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
                    role TEXT NOT NULL CHECK(role IN ('employee','hr','admin')), employee_id TEXT);
            """)

    @contextmanager
    def connection(self, *, write=False):
        db = sqlite3.connect(self.path, timeout=3, isolation_level=None)
        db.row_factory = sqlite3.Row
        try:
            db.execute("BEGIN IMMEDIATE" if write else "BEGIN")
            yield db
            if db.in_transaction:
                db.commit()
        except BaseException:
            if db.in_transaction:
                db.rollback()
            raise
        finally:
            db.close()

    def seed(self, directory: Path):
        with self.connection(write=True) as db:
            if db.execute("SELECT 1 FROM meta WHERE key='revision'").fetchone():
                return
            catalog, employees, events, history = load_directory(directory)
            skills = indexed(catalog.skills, "skill_id")
            profiles = {(p.role, p.grade): p for p in catalog.role_profiles}
            if len(profiles) != len(catalog.role_profiles):
                raise AppError("duplicate_profile", "Duplicate role/grade")
            validate_relations(skills, profiles, employees, events, history, catalog.meta.as_of_date)
            for table, rows in (("skills", skills), ("events", events), ("history", history)):
                db.executemany(f"INSERT INTO {table}(id,body) VALUES (?,?)", [(key, encoded(value)) for key, value in rows.items()])
            db.executemany("INSERT INTO employees VALUES (?,?,1)", [(k, encoded(v)) for k, v in employees.items()])
            db.executemany("INSERT INTO profiles VALUES (?,?,?)", [(role, grade, encoded(p)) for (role, grade), p in profiles.items()])
            db.executemany("INSERT INTO meta VALUES (?,?)", [("revision", "1"), ("as_of", str(catalog.meta.as_of_date))])

    def snapshot(self, db=None):
        if db is None:
            with self.connection() as connection:
                return self.snapshot(connection)
        def bodies(table):
            return {r["id"]: json.loads(r["body"]) for r in db.execute(f"SELECT id,body FROM {table} ORDER BY id")}
        meta = dict(db.execute("SELECT key,value FROM meta"))
        return Snapshot(
            skills=bodies("skills"),
            profiles={(r["role"], r["grade"]): json.loads(r["body"]) for r in db.execute("SELECT * FROM profiles")},
            employees=bodies("employees"), events=bodies("events"), history=list(bodies("history").values()),
            completions=[json.loads(r[0]) for r in db.execute("SELECT body FROM completions ORDER BY rowid")],
            employee_versions=dict(db.execute("SELECT id,version FROM employees")),
            as_of=date.fromisoformat(meta["as_of"]), state_revision=int(meta["revision"]),
        )

    def revision(self):
        with self.connection() as db:
            return int(db.execute("SELECT value FROM meta WHERE key='revision'").fetchone()[0])

    @staticmethod
    def bump(db):
        db.execute("UPDATE meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'")
        return int(db.execute("SELECT value FROM meta WHERE key='revision'").fetchone()[0])

    def import_batch(self, employees, history):
        indexed(employees, "employee_id")
        with self.connection(write=True) as db:
            snap = self.snapshot(db)
            merged_employees = {k: Employee.model_validate(v) for k, v in snap.employees.items()}
            merged_history = {h["record_id"]: HistoryRecord.model_validate(h) for h in snap.history}
            imported, duplicates = {}, 0
            for row in history:
                old = merged_history.get(row.record_id)
                if old is not None:
                    if encoded(old) != encoded(row):
                        raise AppError("history_conflict", "record_id already has different content", status=409,
                                       details=[{"file": "history_file", "field": "record_id", "message": row.record_id}])
                    duplicates += 1
                else:
                    merged_history[row.record_id] = row
                    imported[row.record_id] = row
            for employee in employees:
                old = snap.employees.get(employee.employee_id)
                marks = [c for c in snap.completions if c["employee_id"] == employee.employee_id]
                if old and marks and encoded(old) != encoded(employee):
                    raise AppError("baseline_has_completions", "Cannot replace a baseline with demo completions without reconciliation", status=409)
                merged_employees[employee.employee_id] = employee
            # Do not let imported history independently duplicate a runtime mark.
            for h in imported.values():
                for c in snap.completions:
                    if h.employee_id == c["employee_id"] and h.event_id == c["event_id"] and (
                        h.event_id != "EV_036" or str(h.date) == c["occurrence_key"]
                    ):
                        raise AppError("completion_history_conflict", "Imported participation overlaps a demo completion", status=409)
            validate_relations(
                {k: Skill.model_validate(v) for k, v in snap.skills.items()},
                {k: RoleProfile.model_validate(v) for k, v in snap.profiles.items()},
                merged_employees, {k: Event.model_validate(v) for k, v in snap.events.items()},
                merged_history, snap.as_of,
            )
            db.executemany(
                "INSERT INTO employees VALUES (?,?,1) ON CONFLICT(id) DO UPDATE SET body=excluded.body, version=employees.version+1",
                [(e.employee_id, encoded(e)) for e in employees],
            )
            db.executemany("INSERT INTO history VALUES (?,?)", [(k, encoded(v)) for k, v in imported.items()])
            revision = self.bump(db) if employees or imported else snap.state_revision
            return dict(employee_ids=[e.employee_id for e in employees], employees_upserted=len(employees),
                        history_imported=len(imported), history_duplicates_skipped=duplicates, state_revision=revision)

    def complete(self, employee_id, event_id, occurrence_key, *, user_id, idempotency_key, validate):
        fingerprint = encoded([employee_id, event_id, occurrence_key])
        with self.connection(write=True) as db:
            snap = self.snapshot(db)
            if employee_id not in snap.employees or event_id not in snap.events:
                raise AppError("not_found", "Employee or event does not exist", status=404)
            old = db.execute("SELECT fingerprint FROM operations WHERE user_id=? AND key=?", (user_id, idempotency_key)).fetchone()
            if old and old[0] != fingerprint:
                raise AppError("idempotency_conflict", "Idempotency-Key was used for another request", status=409)
            event = snap.events[event_id]
            if event_id == "EV_036":
                if occurrence_key not in event["upcoming_sessions"]:
                    raise AppError("invalid_occurrence", "Club requires an existing session date")
            elif occurrence_key is not None:
                raise AppError("invalid_occurrence", "Ordinary activities require occurrence_key=null")
            occurrence = occurrence_key or ""
            done = db.execute("SELECT 1 FROM completions WHERE employee_id=? AND event_id=? AND occurrence=?", (employee_id, event_id, occurrence)).fetchone()
            historical = any(h["employee_id"] == employee_id and h["event_id"] == event_id and h["status"] == "completed"
                             and (event_id != "EV_036" or h["date"] == occurrence_key) for h in snap.history)
            if old or done or historical:
                db.execute("INSERT OR IGNORE INTO operations VALUES (?,?,?)", (user_id, idempotency_key, fingerprint))
                return "already_completed"
            validate(snap, employee_id, event_id, occurrence_key)
            pending = [h for h in snap.history if h["employee_id"] == employee_id and h["event_id"] == event_id
                       and h["status"] in ("in_progress", "overdue") and (event_id != "EV_036" or h["date"] == occurrence_key)]
            replaced = max(pending, key=lambda h: (h["date"], h["record_id"])) if pending else None
            mark = dict(record_id="DEMO_" + uuid4().hex, employee_id=employee_id, event_id=event_id,
                        occurrence_key=occurrence_key, date=str(snap.as_of), created_at=datetime.now(timezone.utc).isoformat(),
                        source="demo", baseline_version=snap.employee_versions[employee_id],
                        replaces_record_id=replaced["record_id"] if replaced else None, status="completed", completion_pct=100,
                        score=None, feedback_rating=None, due_date=replaced["due_date"] if replaced else None,
                        assigned_by=replaced["assigned_by"] if replaced else "self")
            db.execute("INSERT INTO completions VALUES (?,?,?,?)", (employee_id, event_id, occurrence, encoded(mark)))
            db.execute("INSERT INTO operations VALUES (?,?,?)", (user_id, idempotency_key, fingerprint))
            self.bump(db)
            return "completed"

    def seed_users(self, users):
        with self.connection(write=True) as db:
            for user in users:
                if user["employee_id"] and not db.execute("SELECT 1 FROM employees WHERE id=?", (user["employee_id"],)).fetchone():
                    raise ValueError("Demo employee does not exist")
                db.execute("INSERT OR IGNORE INTO users VALUES (:user_id,:username,:password_hash,:role,:employee_id)", user)

    def user(self, *, username=None, user_id=None):
        with self.connection() as db:
            if username is not None:
                row = db.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
            else:
                row = db.execute("SELECT * FROM users WHERE user_id=?", (user_id,)).fetchone()
            return dict(row) if row else None
