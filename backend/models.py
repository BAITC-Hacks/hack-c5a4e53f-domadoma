from datetime import date as Date
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Identifier = Annotated[str, Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")]
Level = Annotated[int, Field(strict=True, ge=0, le=5)]
Grade = Literal["Junior", "Middle", "Senior", "Lead"]
EventType = Literal["compliance", "onboarding", "course", "workshop", "mentoring", "certification", "meetup"]
EventFormat = Literal["online", "offline", "self_paced"]
Status = Literal["completed", "in_progress", "dropped", "no_show", "declined", "overdue"]


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Meta(Model):
    dataset: str
    version: str
    as_of_date: Date


class Skill(Model):
    skill_id: Identifier
    name: str
    type: Literal["hard", "soft"]
    category: str
    description: str


class RoleProfile(Model):
    role: str
    grade: Grade
    required_skills: dict[Identifier, Level]
    critical_skills: list[Identifier]


class CareerGoal(Model):
    target_role: str
    target_grade: Grade


class Employee(Model):
    employee_id: Identifier
    full_name: str = Field(min_length=1, max_length=200)
    department: str
    role: str
    grade: Grade
    manager_id: Identifier | None = None
    hire_date: Date
    tenure_months: Annotated[int, Field(strict=True, ge=0)]
    work_format: Literal["office", "hybrid", "remote"]
    preferred_language: Literal["kk", "ru", "en"] = "ru"
    career_goal: CareerGoal | None = None
    skills: dict[Identifier, Level]
    last_review_date: Date


class SkillEffect(Model):
    skill_id: Identifier
    gain: Annotated[int, Field(strict=True, ge=0, le=5)]
    max_level: Level


class Event(Model):
    event_id: Identifier
    title: str = Field(min_length=1, max_length=300)
    description: str = Field(max_length=5000)
    type: EventType
    format: EventFormat
    duration_hours: float = Field(gt=0, le=10000)
    mandatory: Annotated[bool, Field(strict=True)]
    target_roles: list[str] = Field(min_length=1)
    target_grades: list[Grade] = Field(min_length=1)
    develops_skills: list[SkillEffect]
    prerequisites: dict[Identifier, Level]
    upcoming_sessions: list[Date]

    @model_validator(mode="after")
    def unique_effects(self):
        ids = [x.skill_id for x in self.develops_skills]
        if len(ids) != len(set(ids)):
            raise ValueError("Repeated skill in develops_skills")
        if self.format == "self_paced" and self.upcoming_sessions:
            raise ValueError("self_paced activities cannot have scheduled sessions")
        return self


class HistoryRecord(Model):
    record_id: Identifier
    employee_id: Identifier
    event_id: Identifier
    date: Date
    due_date: Date | None = None
    status: Status
    completion_pct: Annotated[int, Field(strict=True, ge=0, le=100)]
    score: Annotated[int, Field(strict=True, ge=0, le=100)] | None = None
    feedback_rating: Annotated[int, Field(strict=True, ge=1, le=5)] | None = None
    assigned_by: Literal["self", "manager", "hr"]

    @model_validator(mode="after")
    def consistent_status(self):
        if self.status == "completed" and self.completion_pct != 100:
            raise ValueError("completed requires completion_pct=100")
        if self.status in ("declined", "no_show") and self.completion_pct != 0:
            raise ValueError("declined/no_show requires completion_pct=0")
        if self.status in ("in_progress", "overdue") and self.completion_pct > 95:
            raise ValueError("in_progress/overdue requires completion_pct<=95")
        if self.status == "dropped" and not 5 <= self.completion_pct <= 95:
            raise ValueError("dropped requires completion_pct between 5 and 95")
        if self.status == "declined" and self.assigned_by == "self":
            raise ValueError("declined applies to manager/HR assignments")
        if self.status == "overdue" and self.due_date is None:
            raise ValueError("overdue requires due_date")
        return self


class SkillDocument(Model):
    meta: Meta
    proficiency_scale: dict[str, str]
    skills: list[Skill]
    role_profiles: list[RoleProfile]


class EmployeeDocument(Model):
    meta: Meta | None = None
    employees: list[Employee]


class EventDocument(Model):
    meta: Meta | None = None
    events: list[Event]
