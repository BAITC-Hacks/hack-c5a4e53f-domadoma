"""Parsing and referential integrity. No mutation until every check succeeds."""
import csv
import io
import json
from pathlib import Path

from pydantic import ValidationError

from .errors import DomainError
from .models import EmployeeDocument, EventDocument, HistoryRecord, SkillDocument


def parse_json(raw: bytes, name: str):
    try:
        return json.loads(raw.decode("utf-8-sig"))
    except (ValueError, UnicodeDecodeError) as exc:
        raise DomainError("invalid_json", f"Invalid UTF-8 JSON: {name}") from exc


def validation_details(exc: ValidationError, *, file=None, row=None):
    return [{"field": ".".join(map(str, e["loc"])), "message": e["msg"],
             **({"file": file} if file else {}), **({"row": row} if row else {})} for e in exc.errors()]


def parse_history(raw: bytes) -> list[HistoryRecord]:
    try:
        reader = csv.DictReader(io.StringIO(raw.decode("utf-8-sig")), strict=True)
        expected = set(HistoryRecord.model_fields)
        if not reader.fieldnames or set(reader.fieldnames) != expected or len(reader.fieldnames) != len(expected):
            raise DomainError("invalid_csv_headers", "CSV must contain the dataset's ten history columns", details=[{"file": "history_file", "field": "headers", "message": ", ".join(sorted(expected))}])
        rows = []
        for row_no, row in enumerate(reader, 2):
            if None in row or any(v is None for v in row.values()):
                raise DomainError("invalid_csv_row", "Incorrect number of columns", details=[{"file": "history_file", "row": row_no, "message": "Incorrect number of columns"}])
            for key in ("score", "feedback_rating", "due_date"):
                row[key] = row[key].strip() or None
            for key in ("completion_pct", "score", "feedback_rating"):
                if row[key] is not None:
                    try:
                        row[key] = int(row[key])
                    except ValueError as exc:
                        raise DomainError("invalid_csv_number", "CSV integer expected", details=[{"file": "history_file", "row": row_no, "field": key, "message": "Expected integer"}]) from exc
            try:
                rows.append(HistoryRecord.model_validate(row))
            except ValidationError as exc:
                raise DomainError("invalid_history", f"Invalid CSV row {row_no}", details=validation_details(exc, file="history_file", row=row_no)) from exc
            if len(rows) > 50000:
                raise DomainError("too_many_history_rows", "At most 50000 history rows per upload")
        return rows
    except (UnicodeDecodeError, csv.Error) as exc:
        raise DomainError("invalid_csv", "Invalid UTF-8 CSV") from exc


def indexed(rows, key):
    result = {}
    for item in rows:
        identifier = getattr(item, key)
        if identifier in result:
            raise DomainError("duplicate_id", f"Duplicate {key}: {identifier}")
        result[identifier] = item
    return result


def load_directory(path: Path):
    try:
        skills = SkillDocument.model_validate(parse_json((path / "skills.json").read_bytes(), "skills.json"))
        employees = EmployeeDocument.model_validate(parse_json((path / "employees.json").read_bytes(), "employees.json"))
        events = EventDocument.model_validate(parse_json((path / "events.json").read_bytes(), "events.json"))
        history = parse_history((path / "activity_history.csv").read_bytes())
    except OSError as exc:
        raise DomainError("dataset_unavailable", f"Cannot read dataset in {path}") from exc
    except ValidationError as exc:
        raise DomainError("invalid_dataset", "Dataset schema validation failed", details=validation_details(exc)) from exc
    for document in (employees, events):
        if document.meta and document.meta != skills.meta:
            raise DomainError("inconsistent_metadata", "Dataset metadata must match across files")
    return skills, indexed(employees.employees, "employee_id"), indexed(events.events, "event_id"), indexed(history, "record_id")


def validate_relations(skills, role_profiles, employees, events, history, as_of_date):
    known_roles = {key[0] for key in role_profiles}
    for rp in role_profiles.values():
        if not set(rp.required_skills) <= skills.keys() or not set(rp.critical_skills) <= rp.required_skills.keys():
            raise DomainError("invalid_requirements", f"Unknown skill in {rp.role}/{rp.grade}")
    for e in employees.values():
        if (e.role, e.grade) not in role_profiles:
            raise DomainError("unknown_role_profile", f"Unknown role/grade for {e.employee_id}")
        if not e.skills.keys() <= skills.keys():
            raise DomainError("unknown_skill", f"Unknown skill for {e.employee_id}")
        if e.career_goal and (e.career_goal.target_role, e.career_goal.target_grade) not in role_profiles:
            raise DomainError("unknown_career_target", f"Unknown target for {e.employee_id}")
        if e.manager_id:
            m = employees.get(e.manager_id)
            if not m or m.employee_id == e.employee_id or m.grade != "Lead" or m.department != e.department:
                raise DomainError("invalid_manager", f"Invalid manager for {e.employee_id}")
        if not e.hire_date <= e.last_review_date <= as_of_date:
            raise DomainError("invalid_employee_dates", f"Review must fall between hire and dataset date: {e.employee_id}")
    for v in events.values():
        skill_ids = {g.skill_id for g in v.develops_skills} | v.prerequisites.keys()
        if not skill_ids <= skills.keys() or not set(v.target_roles) <= known_roles:
            raise DomainError("invalid_event_reference", f"Unknown skill/role in {v.event_id}")
    for h in history.values():
        if h.employee_id not in employees or h.event_id not in events:
            raise DomainError("unknown_history_reference", f"Unknown employee/event in {h.record_id}")
        v = events[h.event_id]
        if not employees[h.employee_id].hire_date <= h.date <= as_of_date:
            raise DomainError("invalid_history_date", f"History date outside employment/dataset period: {h.record_id}")
        if h.due_date and not v.mandatory:
            raise DomainError("invalid_due_date", f"Voluntary activity has due_date: {h.record_id}")
        if h.status == "overdue" and (not v.mandatory or h.due_date >= as_of_date):
            raise DomainError("invalid_overdue", f"Invalid overdue record: {h.record_id}")
        if h.status == "no_show" and v.format == "self_paced":
            raise DomainError("invalid_no_show", f"Self-paced activity has no_show: {h.record_id}")
        if h.score is not None and v.type not in ("course", "certification", "compliance"):
            raise DomainError("invalid_score", f"Activity type cannot have score: {h.record_id}")
    # Attendance may use an earlier grade; don't apply current audience filters here.
    completed = set()
    for h in sorted(history.values(), key=lambda x: (x.date, x.record_id)):
        pair = (h.employee_id, h.event_id)
        if pair in completed and not events[h.event_id].mandatory and h.event_id != "EV_036":
            raise DomainError("repeated_completed_activity", f"Non-repeatable event after completion: {h.record_id}")
        if h.status == "completed":
            completed.add(pair)

def parse_employees(raw: bytes):
    value = parse_json(raw, "employees_file")
    if isinstance(value, list):
        value = {"employees": value}
    elif isinstance(value, dict) and "employees" not in value:
        value = {"employees": [value]}
    try:
        document = EmployeeDocument.model_validate(value)
    except ValidationError as exc:
        raise DomainError("invalid_employees", "Invalid employee profiles", details=validation_details(exc, file="employees_file")) from exc
    indexed(document.employees, "employee_id")
    if len(document.employees) > 5000:
        raise DomainError("too_many_employees", "At most 5000 employees per upload")
    return document.employees
