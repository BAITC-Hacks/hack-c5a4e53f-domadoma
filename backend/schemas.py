from typing import Any, Literal

from pydantic import Field

from .models import Grade, HistoryRecord, Identifier, Level, Model


class LoginRequest(Model):
    username: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=1, max_length=1024)


class UserResponse(Model):
    user_id: str
    role: Literal["employee", "hr", "admin"]
    employee_id: str | None


class LoginResponse(Model):
    access_token: str
    token_type: Literal["bearer"]
    user: UserResponse


class CompletionRequest(Model):
    occurrence_key: str | None = Field(default=None, max_length=40)


class EmployeeSummary(Model):
    employee_id: Identifier
    full_name: str
    role: str
    grade: Grade


class EmployeeInfo(EmployeeSummary):
    department: str
    preferred_language: Literal["ru", "kk", "en"]


class EmployeesResponse(Model):
    employees: list[EmployeeSummary]


class Target(Model):
    role: str
    grade: Grade
    source: Literal["career_goal", "next_grade", "current_grade"]


class Readiness(Model):
    pct: float = Field(ge=0, le=100)
    critical_met: int = Field(ge=0)
    critical_total: int = Field(ge=0)


class SkillState(Model):
    skill_id: Identifier
    name: str
    current: Level
    required: Level | None
    gap: int = Field(ge=0, le=5)
    critical: bool


class HistoryItem(HistoryRecord):
    title: str


class ProfileResponse(Model):
    employee: EmployeeInfo
    target: Target
    readiness: Readiness
    skills: list[SkillState]
    history: list[HistoryItem]
    state_revision: int


class CompletionResponse(Model):
    status: Literal["completed", "already_completed"]
    profile: ProfileResponse


class Closure(Model):
    skill_id: Identifier
    name: str
    from_level: Level = Field(alias="from")
    to: Level
    required: Level
    critical: bool


class ReasonFactor(Model):
    fact_id: str
    type: str
    values: dict[str, Any]


class Recommendation(Model):
    event_id: Identifier
    title: str
    type: str
    format: str
    duration_hours: float
    next_session: str | None
    score: float
    impact: float
    likelihood: float
    closes: list[Closure]
    unlocks: list[Any]
    reasons: list[str]
    reason_factors: list[ReasonFactor]


class NotChosen(Model):
    skill_id: Identifier
    text: str


class RecommendationResponse(Model):
    employee_id: Identifier
    language: Literal["ru", "kk", "en"]
    state_revision: int
    source: Literal["llm", "fallback"]
    fallback_reason: str | None
    leader_override: bool
    duration_ms: float = Field(ge=0)
    recommendations: list[Recommendation]
    not_chosen: NotChosen | None
    uncovered_critical: list[Identifier]
    empty_reason: Literal["target_covered", "no_eligible_events", "missing_prerequisites", "catalog_gap"] | None


class WeakSkill(Model):
    skill_id: Identifier
    name: str
    employees: int
    critical_for: int


class NoRecommendation(Model):
    employee_id: Identifier
    role: str
    grade: Grade
    open_gaps: list[Identifier]
    blocked_by_prereq: list[dict[str, Any]]


class Participation(Model):
    title: str
    completed: int
    total: int
    no_show: int
    declined: int
    dropped: int


class HRResponse(Model):
    state_revision: int
    weak_skills: list[WeakSkill]
    no_recommendation: list[NoRecommendation]
    participation: list[Participation]


class ImportResponse(Model):
    employee_ids: list[Identifier]
    employees_upserted: int
    history_imported: int
    history_duplicates_skipped: int
    state_revision: int
