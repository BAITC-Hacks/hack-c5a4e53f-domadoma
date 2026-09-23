from pathlib import Path
import runpy

import pytest

from backend.recommendation import engine

DATA = Path(__file__).parents[2] / "data"
FIX = Path(__file__).parent / "fixtures"

@pytest.fixture(scope="module")
def d():
    if not (FIX / "employees.json").exists():
        runpy.run_path(str(Path(__file__).with_name("make_fixtures.py")))
    data = engine.Data.from_dir(DATA)
    # загрузка дополнительных профилей и истории — как на защите
    assert data.load_employees(FIX / "employees.json") == []
    assert data.load_history(FIX / "activity_history.csv") == []
    engine.calibrate(data)
    return data

def skills_of(rec):
    return {c["skill_id"] for c in rec["closes"]}

def test_case_example_not_min_skill(d):
    r = engine.recommend(d, "T001")
    top = r["recommendations"][0]
    assert "SK_SYSTEM_DESIGN" in skills_of(top), top
    assert all(x["event_id"] != "EV_036" for x in r["recommendations"][:2])
    text = " ".join(top["reasons"])
    assert "Цель:" in text and "при требуемых" in text and "История участия" in text  # ≥3 фактора
    assert r["not_chosen"]["skill_id"] == "SK_PUBLIC_SPEAKING"

def test_completion_after_review_applied(d):
    r = engine.recommend(d, "T002")
    assert r["skills"]["SK_SYSTEM_DESIGN"] == 3
    assert all(x["event_id"] != "EV_006" for x in r["recommendations"])

def test_prerequisite_unlock(d):
    r = engine.recommend(d, "T003")
    top = r["recommendations"][0]
    assert top["event_id"] == "EV_005" and top["unlocks"]
    assert {b["event_id"] for b in r["blocked"]} >= {"EV_006", "EV_007"}

def test_career_switch_goal(d):
    r = engine.recommend(d, "T004")
    assert r["target"] == {"role": "Data Analyst", "grade": "Middle", "source": "career_goal"}
    assert any("Data Analyst" in d.events[x["event_id"]]["target_roles"] for x in r["recommendations"])

def test_progress_update(d):
    before = engine.recommend(d, "T001")
    ev = before["recommendations"][0]["event_id"]
    after = engine.recommend(d, "T001", extra_completed=[ev])
    assert after["readiness"]["pct"] > before["readiness"]["pct"]
    assert all(x["event_id"] != ev for x in after["recommendations"])

def test_rules_on_full_dataset(d):
    for eid in d.employees:
        r = engine.recommend(d, eid)
        done = {h["event_id"] for h in d.history_of(eid) if h["status"] == "completed"}
        for x in r["recommendations"]:
            ev = d.events[x["event_id"]]
            assert not ev["mandatory"]
            assert x["event_id"] not in done or x["event_id"] in engine.RECURRING
            assert all(r["skills"].get(s, 0) >= v for s, v in ev["prerequisites"].items())
            assert 1 <= len(r["recommendations"]) <= 3


def test_calibration_is_isolated_per_snapshot():
    first = engine.Data(
        events={"EV": {"event_id": "EV", "mandatory": False, "develops_skills": [], "format": "online", "type": "workshop"}},
        history=[{"employee_id": "E1", "event_id": "EV", "status": "completed", "date": "2026-01-01"}],
    )
    second = engine.Data(
        events={"EV": {"event_id": "EV", "mandatory": False, "develops_skills": [], "format": "online", "type": "workshop"}},
        history=[{"employee_id": "E2", "event_id": "EV", "status": "no_show", "date": "2026-01-01"}],
    )

    engine.calibrate(first)
    first_rate = engine.likelihood(engine.engagement(first, "E1"), first.events["EV"], first.prior)[0]
    engine.calibrate(second)
    second_rate = engine.likelihood(engine.engagement(first, "E1"), first.events["EV"], first.prior)[0]

    assert first_rate == second_rate
