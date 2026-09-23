import json
from pathlib import Path

import pytest

from backend.errors import AppError
from backend.loading import parse_employees, parse_history
from backend.repository import Repository

DATA = Path(__file__).resolve().parents[2] / "work/karim312k1"
if (Path(__file__).resolve().parents[2] / "data/employees.json").exists():
    DATA = Path(__file__).resolve().parents[2] / "data"


@pytest.fixture
def repo(tmp_path):
    repository = Repository(tmp_path / "test.sqlite3")
    repository.seed(DATA)
    return repository


def new_employee(repo):
    employee = dict(repo.snapshot().employees["E0002"])
    employee["employee_id"] = "TEST_001"
    return employee


def test_seed_persists_import_and_revision(repo):
    employee = new_employee(repo)
    result = repo.import_batch(parse_employees(json.dumps(employee).encode()), [])
    assert result["employee_ids"] == ["TEST_001"]
    repo.seed(Path("missing-source-on-restart"))
    reopened = Repository(repo.path)
    assert reopened.snapshot().employees["TEST_001"] == employee
    assert reopened.revision() == 2


def test_real_dataset_counts_and_types(repo):
    snap = repo.snapshot()
    assert (len(snap.employees), len(snap.skills), len(snap.events), len(snap.history)) == (200, 60, 40, 2743)
    assert str(snap.as_of) == "2026-10-01"
    assert isinstance(snap.history[0]["completion_pct"], int)


def test_history_dedup_conflict_is_atomic(repo):
    row = repo.snapshot().history[0]
    from backend.models import HistoryRecord
    unchanged = HistoryRecord.model_validate(row)
    first = repo.import_batch([], [unchanged])
    assert first["history_duplicates_skipped"] == 1
    changed = unchanged.model_copy(update={"assigned_by": "hr" if unchanged.assigned_by != "hr" else "manager"})
    before = repo.revision()
    with pytest.raises(AppError) as error:
        repo.import_batch(parse_employees(json.dumps(new_employee(repo)).encode()), [changed])
    assert error.value.status == 409
    assert "TEST_001" not in repo.snapshot().employees
    assert repo.revision() == before


def test_bad_reference_rolls_back(repo):
    employee = new_employee(repo)
    employee["skills"]["DOES_NOT_EXIST"] = 3
    with pytest.raises(AppError):
        repo.import_batch(parse_employees(json.dumps(employee).encode()), [])
    assert "TEST_001" not in repo.snapshot().employees
    assert repo.revision() == 1


def test_json_bom_and_invalid_csv():
    assert parse_employees(b"\xef\xbb\xbf[]") == []
    with pytest.raises(AppError):
        parse_history(b"record_id,record_id\na,b\n")


def mark(repo, event="EV_005", occurrence=None, key="one"):
    return repo.complete("E0002", event, occurrence, user_id="admin", idempotency_key=key,
                         validate=lambda *args: None)  # Persistence test, not domain eligibility.


def test_simultaneous_completion_once(repo):
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(lambda key: mark(repo, key=key), ["first", "second"]))
    assert sorted(results) == ["already_completed", "completed"]
    assert repo.revision() == 2
    assert len(repo.snapshot().completions) == 1


def test_club_occurrences_and_restart(repo):
    sessions = repo.snapshot().events["EV_036"]["upcoming_sessions"]
    assert mark(repo, "EV_036", sessions[0]) == "completed"
    assert mark(repo, "EV_036", sessions[0], "two") == "already_completed"
    assert mark(repo, "EV_036", sessions[1], "three") == "completed"
    reopened = Repository(repo.path)
    reopened.seed(Path("not-needed"))
    assert len(reopened.snapshot().completions) == 2
    assert reopened.revision() == 3


def test_same_day_review_and_reimport_preserve_marks(repo):
    from backend.models import Employee
    baseline = dict(repo.snapshot().employees["E0002"])
    baseline["last_review_date"] = "2026-10-01"
    repo.import_batch([Employee.model_validate(baseline)], [])
    mark(repo)
    repo.import_batch([Employee.model_validate(baseline)], [])
    snap = repo.snapshot()
    assert len(snap.completions) == 1
    assert snap.completions[0]["date"] == snap.employees["E0002"]["last_review_date"]
    assert snap.employees["E0002"]["skills"] == baseline["skills"]
    baseline["skills"] = {**baseline["skills"], "SK_PYTHON": 4}
    with pytest.raises(AppError) as error:
        repo.import_batch([Employee.model_validate(baseline)], [])
    assert error.value.code == "baseline_has_completions"
    assert repo.snapshot().employees["E0002"]["skills"] == snap.employees["E0002"]["skills"]


def test_new_employee_with_history_same_batch(repo):
    from backend.models import HistoryRecord
    employee = new_employee(repo)
    row = next(h for h in repo.snapshot().history if h["employee_id"] == "E0002")
    row = {**row, "employee_id": "TEST_001", "record_id": "TEST_HISTORY"}
    result = repo.import_batch(parse_employees(json.dumps(employee).encode()), [HistoryRecord.model_validate(row)])
    assert result["history_imported"] == 1
    assert result["employee_ids"] == ["TEST_001"]
