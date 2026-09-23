"""Service adapter between the deterministic recommendation engine and backend."""

from __future__ import annotations

import asyncio
import json
import os
import time
from typing import Any

from . import engine

ALGORITHM_VERSION = "1"
PROMPT_VERSION = "1"
LLM_TIMEOUT_SECONDS = 6.0
MAX_CANDIDATES = 5
MAX_RECOMMENDATIONS = 3
SUPPORTED_LANGUAGES = {"ru", "kk", "en"}


def _employee_view(employee: dict[str, Any]) -> dict[str, Any]:
    allowed = ("employee_id", "full_name", "department", "role", "grade", "preferred_language")
    return {key: employee.get(key) for key in allowed}


def _history_view(data: engine.Data, employee_id: str) -> list[dict[str, Any]]:
    result = []
    for row in data.history_of(employee_id):
        item = dict(row)
        for key in ("completion_pct", "feedback_rating"):
            value = item.get(key)
            item[key] = int(value) if value not in (None, "") else None
        value = item.get("score")
        item["score"] = float(value) if value not in (None, "") else None
        result.append(item)
    return result


def analyze_employee(data: engine.Data, employee_id: str) -> dict[str, Any]:
    """Build a deterministic ProfileResponse-shaped object without I/O or LLM calls."""
    employee = data.employees[employee_id]
    skills, _ = engine.effective_skills(data, employee)
    gaps, target, source = engine.skill_gaps(data, employee, skills)
    target_required = target["required_skills"]
    skill_rows = []
    for skill_id, skill in data.skills.items():
        required = target_required.get(skill_id)
        skill_rows.append(
            {
                "skill_id": skill_id,
                "name": skill["name"],
                "current": skills.get(skill_id, 0),
                "required": required,
                "gap": gaps[skill_id]["gap"] if skill_id in gaps else 0,
                "critical": skill_id in target.get("critical_skills", []),
            }
        )
    return {
        "employee": _employee_view(employee),
        "target": {"role": target["role"], "grade": target["grade"], "source": source},
        "readiness": engine.readiness(data, employee, skills),
        "skills": skill_rows,
        "history": _history_view(data, employee_id),
    }


def _language(data: engine.Data, employee_id: str, language: str | None) -> str:
    if language in SUPPORTED_LANGUAGES:
        return language
    preferred = data.employees[employee_id].get("preferred_language")
    return preferred if preferred in SUPPORTED_LANGUAGES else "en"


def _fact_registry(data: engine.Data, employee_id: str, baseline: dict[str, Any]) -> dict[str, dict[str, Any]]:
    employee = data.employees[employee_id]
    registry: dict[str, dict[str, Any]] = {}
    for recommendation in baseline["recommendations"]:
        event_id = recommendation["event_id"]
        facts = [
            {
                "fact_id": f"{event_id}:target",
                "type": "target",
                "values": {"target_role": baseline["target"]["role"], "target_grade": baseline["target"]["grade"]},
            },
            {
                "fact_id": f"{event_id}:history",
                "type": "history",
                "values": {"employee_id": employee_id, "has_history": bool(engine.engagement(data, employee_id)["all"][1])},
            },
        ]
        for close in recommendation["closes"]:
            skill_id = close["skill_id"]
            facts.append(
                {
                    "fact_id": f"{event_id}:gap:{skill_id}",
                    "type": "skill_gap",
                    "values": {
                        "skill_id": skill_id,
                        "current": close["from"],
                        "required": close["required"],
                    },
                }
            )
            facts.append(
                {
                    "fact_id": f"{event_id}:gain:{skill_id}",
                    "type": "event_gain",
                    "values": {"skill_id": skill_id, "from": close["from"], "to": close["to"]},
                }
            )
        registry[event_id] = {"facts": facts, "fact_ids": {fact["fact_id"] for fact in facts}}
    return registry


def _reason_factors(registry: dict[str, Any], event_id: str, fact_ids: list[str] | None = None) -> list[dict[str, Any]]:
    facts = registry[event_id]["facts"]
    if fact_ids is None:
        return facts
    selected = [fact for fact in facts if fact["fact_id"] in fact_ids]
    categories = {fact["type"] for fact in selected}
    if len(categories) < 3:
        return []
    return selected


def _fallback_reason(error: BaseException | None) -> str:
    if error is None:
        return "llm_unavailable"
    if isinstance(error, (TimeoutError, asyncio.TimeoutError)):
        return "llm_timeout"
    if isinstance(error, ValueError):
        return "llm_invalid_response"
    return "llm_error"


def _leader_is_protected(baseline: dict[str, Any]) -> bool:
    recommendations = baseline["recommendations"]
    if not recommendations or recommendations[0].get("raw_score", recommendations[0]["score"]) <= 0:
        return False
    if len(recommendations) == 1:
        return True
    leader_score = recommendations[0].get("raw_score", recommendations[0]["score"])
    second_score = recommendations[1].get("raw_score", recommendations[1]["score"])
    return leader_score / max(second_score, 1e-12) >= 1.35


def _validate_llm_choices(raw: Any, baseline: dict[str, Any], registry: dict[str, Any]) -> list[dict[str, Any]]:
    if not isinstance(raw, dict) or not isinstance(raw.get("choices"), list):
        raise ValueError("choices_missing")
    by_id = {item["event_id"]: item for item in baseline["recommendations"]}
    selected = []
    seen = set()
    for choice in raw["choices"][:MAX_RECOMMENDATIONS]:
        if not isinstance(choice, dict):
            raise ValueError("choice_not_object")
        event_id = choice.get("event_id")
        fact_ids = choice.get("fact_ids")
        if event_id not in by_id or event_id in seen or not isinstance(fact_ids, list):
            raise ValueError("choice_outside_candidate_pool")
        factors = _reason_factors(registry, event_id, fact_ids)
        if not factors:
            raise ValueError("insufficient_reason_factors")
        selected.append({"recommendation": by_id[event_id], "fact_ids": fact_ids, "explanation": choice.get("explanation")})
        seen.add(event_id)
    if not selected:
        raise ValueError("no_choices")
    return selected


def _select_with_leader(baseline: dict[str, Any], selected: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], bool]:
    if not _leader_is_protected(baseline):
        return selected, False
    leader_id = baseline["recommendations"][0]["event_id"]
    leader = next((item for item in selected if item["recommendation"]["event_id"] == leader_id), None)
    if leader is None:
        leader = {"recommendation": baseline["recommendations"][0], "fact_ids": [], "explanation": None}
        selected = [leader] + selected
        selected = selected[:MAX_RECOMMENDATIONS]
        return selected, True
    selected.remove(leader)
    return [leader] + selected, False


def _final_recommendation(item: dict[str, Any], registry: dict[str, Any]) -> dict[str, Any]:
    recommendation = dict(item["recommendation"])
    recommendation["reason_factors"] = _reason_factors(registry, recommendation["event_id"], item.get("fact_ids")) or registry[recommendation["event_id"]]["facts"]
    explanation = item.get("explanation")
    if explanation:
        recommendation["reasons"] = [explanation, *recommendation.get("reasons", [])]
    recommendation.pop("factors", None)
    recommendation.pop("raw_score", None)
    return recommendation


def _call_llm(baseline: dict[str, Any], registry: dict[str, Any], language: str) -> dict[str, Any] | None:
    if not os.getenv("OPENAI_API_KEY"):
        return None
    from pydantic import BaseModel, Field
    from openai import OpenAI

    class Choice(BaseModel):
        event_id: str
        fact_ids: list[str] = Field(default_factory=list)
        explanation: str = ""

    class Decision(BaseModel):
        choices: list[Choice] = Field(default_factory=list)

    client = OpenAI(timeout=LLM_TIMEOUT_SECONDS, max_retries=0)
    candidates = [
        {
            "event_id": item["event_id"],
            "title": item["title"],
            "score": item["score"],
            "facts": registry[item["event_id"]]["facts"],
        }
        for item in baseline["recommendations"]
    ]
    response = client.responses.parse(
        model=os.getenv("OPENAI_MODEL", ""),
        input=[
            {"role": "system", "content": "Select only valid candidate event_ids. Use at least three fact categories per choice. Do not invent facts."},
            {"role": "user", "content": json.dumps({"language": language, "candidates": candidates}, ensure_ascii=False)},
        ],
        text_format=Decision,
    )
    parsed = response.output_parsed
    return {"choices": [choice.model_dump() for choice in parsed.choices]}


async def get_recommendations(
    data: engine.Data,
    employee_id: str,
    *,
    language: str,
    state_revision: int,
) -> dict[str, Any]:
    """Return RecommendationResponse without mutating the supplied snapshot."""
    started = time.perf_counter()
    baseline = engine.recommend(data, employee_id, k=MAX_CANDIDATES)
    registry = _fact_registry(data, employee_id, baseline)
    selected: list[dict[str, Any]] = [
        {"recommendation": item, "fact_ids": [], "explanation": None}
        for item in baseline["recommendations"][:MAX_RECOMMENDATIONS]
    ]
    source = "fallback"
    fallback_reason = None
    leader_override = False
    if selected:
        try:
            raw = await asyncio.wait_for(
                asyncio.to_thread(_call_llm, baseline, registry, _language(data, employee_id, language)),
                timeout=LLM_TIMEOUT_SECONDS + 2,
            )
            if raw is not None:
                selected = _validate_llm_choices(raw, baseline, registry)
                selected, leader_override = _select_with_leader(baseline, selected)
                source = "llm"
            else:
                fallback_reason = "llm_unavailable"
        except Exception as error:
            fallback_reason = _fallback_reason(error)
    if source == "fallback" and selected:
        selected, leader_override = _select_with_leader(baseline, selected)
    if not selected and fallback_reason is None:
        fallback_reason = "no_candidates"
    result = {
        "employee_id": employee_id,
        "language": _language(data, employee_id, language),
        "state_revision": state_revision,
        "source": source,
        "fallback_reason": fallback_reason,
        "leader_override": leader_override,
        "duration_ms": round((time.perf_counter() - started) * 1000),
        "recommendations": [_final_recommendation(item, registry) for item in selected],
        "not_chosen": baseline["not_chosen"],
        "uncovered_critical": baseline["uncovered_critical"],
        "empty_reason": None if selected else _empty_reason(baseline),
    }
    return result


def _empty_reason(baseline: dict[str, Any]) -> str:
    if not baseline["gaps"]:
        return "target_covered"
    if baseline["blocked"] and not baseline["recommendations"]:
        return "missing_prerequisites"
    return "no_eligible_events"
