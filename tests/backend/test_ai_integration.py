"""Real engine/service + SQLite + HTTP. Only external LLM I/O is disabled."""
from copy import deepcopy

import pytest
from fastapi.testclient import TestClient

from backend.integration import EngineDomain
from backend.main import create_app
from backend.models import Employee
from backend.repository import Repository, encoded
from backend.recommendation import engine, service
from test_api import login, settings
from test_repository import repo


@pytest.fixture(autouse=True)
def offline(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)


@pytest.fixture
def real_client(repo, settings):
    with TestClient(create_app(settings, repository=repo)) as client:
        yield client


def levels(profile):
    return {s["skill_id"]: s["current"] for s in profile["skills"]}


def test_snapshot_calibrated_and_detached(repo, monkeypatch):
    snap = repo.snapshot()
    original = deepcopy(snap)
    calls = []
    calibrate = engine.calibrate
    def observed(data):
        calls.append(data)
        return calibrate(data)
    monkeypatch.setattr(engine, "calibrate", observed)
    data = EngineDomain().data(snap)
    assert calls == [data]
    expected = engine.Data(skills=snap.skills, profiles=snap.profiles, employees=snap.employees,
                           events=snap.events, history=snap.history, as_of=snap.as_of)
    calibrate(expected)
    assert data.prior == expected.prior
    assert snap == original


def test_real_profile_recommendations_and_scope(real_client):
    headers = login(real_client)
    profile = real_client.get("/api/employees/E0002", headers=headers)
    assert profile.status_code == 200, profile.text
    assert levels(profile.json())["SK_SYSTEM_DESIGN"] == 1
    assert profile.json()["state_revision"] == 1
    for language in ("ru", "kk"):
        response = real_client.get(f"/api/employees/E0002/recommendations?lang={language}", headers=headers)
        assert response.status_code == 200, response.text
        value = response.json()
        assert value["language"] == language
        assert value["source"] == "fallback"
        assert value["fallback_reason"] == "llm_unavailable"
        assert value["state_revision"] == 1
        assert 1 <= len(value["recommendations"]) <= 3
    assert real_client.get("/api/employees/E0001", headers=headers).status_code == 403
    assert real_client.get("/api/employees/E0001/recommendations", headers=headers).status_code == 403


@pytest.mark.parametrize("same_day", [False, True])
def test_real_complete_updates_progress_once(repo, real_client, monkeypatch, same_day):
    if same_day:
        e = deepcopy(repo.snapshot().employees["E0002"])
        e["last_review_date"] = "2026-10-01"
        repo.import_batch([Employee.model_validate(e)], [])
    original = deepcopy(repo.snapshot().employees["E0002"])
    headers = login(real_client)
    url = "/api/employees/E0002"
    before = real_client.get(url, headers=headers).json()
    def no_llm(*args):
        raise AssertionError("Complete must not invoke LLM")
    with monkeypatch.context() as patch:
        patch.setattr(service, "_call_llm", no_llm)
        complete = real_client.post(url + "/activities/EV_005/complete", headers={**headers, "Idempotency-Key": "real-click"}, json={"occurrence_key": None})
        assert complete.status_code == 200, complete.text
        after = complete.json()["profile"]
        assert levels(after)["SK_SYSTEM_DESIGN"] == levels(before)["SK_SYSTEM_DESIGN"] + 1
        assert after["readiness"]["pct"] > before["readiness"]["pct"]
        assert after["state_revision"] == before["state_revision"] + 1
        assert after["employee"]["grade"] == before["employee"]["grade"]
        repeated = real_client.post(url + "/activities/EV_005/complete", headers={**headers, "Idempotency-Key": "second-click"}, json={"occurrence_key": None})
        assert repeated.json()["status"] == "already_completed"
        assert repeated.json()["profile"] == after
    assert repo.snapshot().employees["E0002"] == original
    next_recs = real_client.get(url + "/recommendations", headers=headers)
    assert next_recs.status_code == 200, next_recs.text
    assert next_recs.json()["state_revision"] == after["state_revision"]
    assert "EV_005" not in [r["event_id"] for r in next_recs.json()["recommendations"]]
    assert any(h["event_id"] == "EV_005" and h["status"] == "completed" for h in after["history"])


def test_real_domain_rejects_prerequisites(real_client, repo):
    response = real_client.post("/api/employees/E0002/activities/EV_006/complete", headers={**login(real_client), "Idempotency-Key": "blocked"}, json={"occurrence_key": None})
    assert response.status_code == 409, response.text
    assert repo.revision() == 1
    assert repo.snapshot().completions == []


def test_real_hr_contract(real_client, repo):
    response = real_client.get("/api/hr/overview", headers=login(real_client, "hr"))
    assert response.status_code == 200, response.text
    data = EngineDomain().data(repo.snapshot())
    assert response.json() == {**engine.hr_view(data), "state_revision": 1}


def test_llm_success_shape_through_endpoint(real_client, monkeypatch):
    # Transport double only: validates the success path, NOT a live smoke test.
    def selector(baseline, registry, language):
        first = baseline["recommendations"][0]["event_id"]
        return {"choices": [{"event_id": first, "fact_ids": list(registry[first]["fact_ids"]), "explanation": "Test selector"}]}
    monkeypatch.setattr(service, "_call_llm", selector)
    response = real_client.get("/api/employees/E0002/recommendations", headers=login(real_client))
    assert response.status_code == 200, response.text
    assert response.json()["source"] == "llm"
    assert response.json()["fallback_reason"] is None


def test_club_next_occurrence_and_hr_when_sessions_exhausted(repo, real_client):
    snap = repo.snapshot()
    employee = deepcopy(snap.employees["E0002"])
    employee.update(employee_id="TEST_CLUB", skills={s: 5 for s in snap.skills},
                    last_review_date="2026-10-01", career_goal={"target_role": employee["role"], "target_grade": "Lead"})
    employee["skills"]["SK_PUBLIC_SPEAKING"] = 0
    repo.import_batch([Employee.model_validate(employee)], [])
    # Synthetic catalog has just two club sessions and no alternative activities.
    with repo.connection(write=True) as db:
        for event_id, event in snap.events.items():
            event = deepcopy(event)
            if event_id == "EV_036":
                event["upcoming_sessions"] = event["upcoming_sessions"][:2]
            else:
                event["mandatory"] = True
            db.execute("UPDATE events SET body=? WHERE id=?", (encoded(event), event_id))
    headers = login(real_client, "admin")
    path = "/api/employees/TEST_CLUB"
    for index, session in enumerate(snap.events["EV_036"]["upcoming_sessions"][:2], 1):
        recs = real_client.get(path + "/recommendations", headers=headers).json()
        assert recs["recommendations"][0]["next_session"] == session
        response = real_client.post(path + "/activities/EV_036/complete", headers={**headers, "Idempotency-Key": session}, json={"occurrence_key": session})
        assert response.status_code == 200, response.text
        assert levels(response.json()["profile"])["SK_PUBLIC_SPEAKING"] == index
        repeat = real_client.post(path + "/activities/EV_036/complete", headers={**headers, "Idempotency-Key": session}, json={"occurrence_key": session})
        assert repeat.json()["status"] == "already_completed"
    assert real_client.get(path + "/recommendations", headers=headers).json()["recommendations"] == []
    hr = real_client.get("/api/hr/overview", headers=headers)
    assert hr.status_code == 200, hr.text
    assert "TEST_CLUB" in [r["employee_id"] for r in hr.json()["no_recommendation"]]


def test_capped_gain_restart_and_identical_reimport(repo, real_client, settings):
    employee = deepcopy(repo.snapshot().employees["E0002"])
    employee["skills"]["SK_API_DESIGN"] = 5
    employee["last_review_date"] = "2026-10-01"
    repo.import_batch([Employee.model_validate(employee)], [])
    headers = login(real_client)
    path = "/api/employees/E0002"
    result = real_client.post(path + "/activities/EV_005/complete", headers={**headers, "Idempotency-Key": "cap"}, json={"occurrence_key": None})
    assert result.status_code == 200, result.text
    after = result.json()["profile"]
    assert levels(after)["SK_API_DESIGN"] == 5
    assert levels(after)["SK_SYSTEM_DESIGN"] == 2
    repo.import_batch([Employee.model_validate(employee)], [])
    with TestClient(create_app(settings, repository=Repository(repo.path))) as restarted:
        profile = restarted.get(path, headers=login(restarted)).json()
        assert profile["skills"] == after["skills"]
        assert profile["readiness"] == after["readiness"]
        assert profile["history"] == after["history"]


def test_complete_replaces_in_progress_once_in_hr(repo, real_client):
    from backend.models import HistoryRecord
    row = HistoryRecord(record_id="TEST_PENDING", employee_id="E0002", event_id="EV_005",
                        date="2026-09-30", status="in_progress", completion_pct=20, assigned_by="self")
    repo.import_batch([], [row])
    domain = EngineDomain()
    before_data = domain.data(repo.snapshot())
    before = next(p for p in domain.overview(repo.snapshot())["participation"] if p["title"] == before_data.events["EV_005"]["title"])
    headers = login(real_client)
    response = real_client.post("/api/employees/E0002/activities/EV_005/complete", headers={**headers, "Idempotency-Key": "pending"}, json={"occurrence_key": None})
    assert response.status_code == 200, response.text
    after_data = domain.data(repo.snapshot())
    after = next(p for p in domain.overview(repo.snapshot())["participation"] if p["title"] == after_data.events["EV_005"]["title"])
    assert after["total"] == before["total"]
    assert after["completed"] == before["completed"] + 1
    assert "TEST_PENDING" not in [r["record_id"] for r in after_data.history]
    assert levels(response.json()["profile"])["SK_SYSTEM_DESIGN"] == 2
