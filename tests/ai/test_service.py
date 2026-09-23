import asyncio
from datetime import date

from backend.recommendation import engine
from backend.recommendation import service


def make_data():
    data = engine.Data(
        skills={
            "SK_API": {"skill_id": "SK_API", "name": "API Design"},
            "SK_DESIGN": {"skill_id": "SK_DESIGN", "name": "System Design"},
        },
        profiles={
            ("Engineer", "Middle"): {
                "role": "Engineer",
                "grade": "Middle",
                "required_skills": {"SK_API": 2, "SK_DESIGN": 1},
                "critical_skills": ["SK_API"],
            },
            ("Engineer", "Senior"): {
                "role": "Engineer",
                "grade": "Senior",
                "required_skills": {"SK_API": 3, "SK_DESIGN": 3},
                "critical_skills": ["SK_DESIGN"],
            },
        },
        employees={
            "E1": {
                "employee_id": "E1",
                "full_name": "Test Employee",
                "department": "Engineering",
                "role": "Engineer",
                "grade": "Middle",
                "preferred_language": "ru",
                "career_goal": None,
                "skills": {"SK_API": 2, "SK_DESIGN": 0},
                "last_review_date": "2026-01-01",
            }
        },
        events={
            "EV_DESIGN": {
                "event_id": "EV_DESIGN",
                "title": "System design workshop",
                "type": "workshop",
                "format": "online",
                "duration_hours": 2,
                "upcoming_sessions": ["2026-10-05"],
                "target_roles": ["Engineer"],
                "target_grades": ["Senior"],
                "mandatory": False,
                "prerequisites": {},
                "develops_skills": [{"skill_id": "SK_DESIGN", "gain": 1, "max_level": 5}],
            }
        },
        history=[],
        as_of=date(2026, 10, 1),
    )
    return data


def test_analyze_employee_returns_contract_profile_without_llm():
    result = service.analyze_employee(make_data(), "E1")

    assert result["employee"]["employee_id"] == "E1"
    assert result["target"] == {"role": "Engineer", "grade": "Senior", "source": "next_grade"}
    assert result["readiness"]["pct"] == 33
    assert result["skills"] == [
        {"skill_id": "SK_API", "name": "API Design", "current": 2, "required": 3, "gap": 1, "critical": False},
        {"skill_id": "SK_DESIGN", "name": "System Design", "current": 0, "required": 3, "gap": 3, "critical": True},
    ]


def test_get_recommendations_uses_deterministic_fallback_when_llm_unavailable(monkeypatch):
    monkeypatch.setattr(service, "_call_llm", lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("disabled")))

    result = asyncio.run(service.get_recommendations(make_data(), "E1", language="ru", state_revision=7))

    assert result["source"] == "fallback"
    assert result["fallback_reason"] == "llm_error"
    assert result["state_revision"] == 7
    assert result["recommendations"][0]["event_id"] == "EV_DESIGN"
    assert len(result["recommendations"][0]["reason_factors"]) >= 3


def test_llm_selection_is_limited_to_valid_candidates_and_preserves_leader(monkeypatch):
    monkeypatch.setattr(
        service,
        "_call_llm",
        lambda *args, **kwargs: {
            "choices": [{"event_id": "UNKNOWN", "fact_ids": [], "explanation": "bad"}]
        },
    )

    result = asyncio.run(service.get_recommendations(make_data(), "E1", language="kk", state_revision=2))

    assert result["source"] == "fallback"
    assert result["fallback_reason"] == "llm_invalid_response"
    assert result["recommendations"][0]["event_id"] == "EV_DESIGN"
