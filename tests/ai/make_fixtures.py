"""Профили-ловушки в формате датасета — так же будут выглядеть проверочные профили жюри."""
import csv, json
from pathlib import Path
D = Path(__file__).parent / "fixtures"

# почти готов к Senior Backend: большинство навыков на уровне Senior
BASE = {"SK_PYTHON": 4, "SK_SQL": 4, "SK_API_DESIGN": 4, "SK_SYSTEM_DESIGN": 2, "SK_CLOUD": 3,
        "SK_CONTAINERS": 3, "SK_CICD": 3, "SK_APP_SECURITY": 3, "SK_OBSERVABILITY": 3,
        "SK_COMMUNICATION": 3, "SK_TEAMWORK": 3, "SK_PROBLEM_SOLVING": 4, "SK_MENTORING": 3,
        "SK_LEADERSHIP": 2, "SK_STAKEHOLDER_MGMT": 2, "SK_PUBLIC_SPEAKING": 0}

def emp(eid, skills, goal=None, review="2026-06-01", grade="Middle"):
    return {"employee_id": eid, "full_name": f"Test {eid}", "department": "Backend Development",
            "role": "Backend Engineer", "grade": grade, "manager_id": None, "hire_date": "2022-06-01",
            "tenure_months": 52, "work_format": "hybrid", "preferred_language": "ru",
            "career_goal": goal, "skills": skills, "last_review_date": review}

employees = [
    # T1 — пример из кейса: минимальный навык Public Speaking, 3 неявки, критичен System Design
    emp("T001", dict(BASE)),
    # T2 — System Design уже подтянут курсом ПОСЛЕ последней оценки
    emp("T002", dict(BASE)),
    # T3 — System Design = 1: продвинутые курсы закрыты пререквизитом
    emp("T003", {**BASE, "SK_SYSTEM_DESIGN": 1, "SK_PUBLIC_SPEAKING": 2}),
    # T4 — цель — смена роли: Backend Middle → Data Analyst Middle
    emp("T004", {**BASE, "SK_PUBLIC_SPEAKING": 2}, goal={"target_role": "Data Analyst", "target_grade": "Middle"}),
]
rows = [
    ("X000001", "T001", "EV_036", "2025-03-10", "", "no_show", 0, "", "", "self"),
    ("X000002", "T001", "EV_036", "2025-09-15", "", "no_show", 0, "", "", "manager"),
    ("X000003", "T001", "EV_036", "2026-02-20", "", "declined", 0, "", "", "manager"),
    ("X000004", "T001", "EV_011", "2025-05-12", "", "completed", 100, "", 4, "self"),
    ("X000005", "T001", "EV_019", "2025-11-03", "", "completed", 100, "", 5, "self"),
    ("X000006", "T002", "EV_006", "2026-08-20", "", "completed", 100, "", 5, "self"),
    ("X000007", "T002", "EV_036", "2026-01-15", "", "no_show", 0, "", "", "manager"),
]
D.mkdir(exist_ok=True)
(D / "employees.json").write_text(json.dumps({"employees": employees}, ensure_ascii=False, indent=1), encoding="utf-8")
with open(D / "activity_history.csv", "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(["record_id", "employee_id", "event_id", "date", "due_date", "status",
                "completion_pct", "score", "feedback_rating", "assigned_by"])
    w.writerows(rows)
