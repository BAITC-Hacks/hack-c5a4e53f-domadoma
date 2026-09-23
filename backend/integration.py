"""SQLite-to-AI adapter; all skill math belongs to the unchanged AI engine."""
from copy import copy, deepcopy
from importlib import import_module

from .errors import AppError


class EngineDomain:
    def __init__(self):
        try:
            self.engine = import_module("backend.recommendation.engine")
            self.service = import_module("backend.recommendation.service")
        except ModuleNotFoundError as exc:
            if exc.name not in ("backend.recommendation", "backend.recommendation.engine", "backend.recommendation.service"):
                raise
            self.engine = self.service = None
        self.available = self.engine is not None and self.service is not None

    def data(self, snap):
        if not self.available:
            raise AppError("engine_unavailable", "Recommendation module has not been integrated", status=503)
        replaced = {c["replaces_record_id"] for c in snap.completions if c["replaces_record_id"]}
        data = self.engine.Data(
            skills=deepcopy(snap.skills), profiles=deepcopy(snap.profiles),
            employees=deepcopy(snap.employees), events=deepcopy(snap.events),
            history=[deepcopy(h) for h in snap.history if h["record_id"] not in replaced], as_of=snap.as_of,
        )
        # The original engine has only day precision and ignores history on the
        # review day. Use its existing extra_completed interface, in commit order,
        # for runtime marks. This checkpoint exists ONLY in this detached Data;
        # persisted baseline skills and last_review_date are never overwritten.
        checkpointed = set()
        for mark in snap.completions:
            employee_id = mark["employee_id"]
            employee = data.employees[employee_id]
            if employee_id not in checkpointed:
                employee["skills"], _ = self.engine.effective_skills(data, employee)
                employee["last_review_date"] = str(data.as_of)
                checkpointed.add(employee_id)
            employee["skills"], _ = self.engine.effective_skills(data, employee, extra_completed=[mark["event_id"]])
        # Append once AFTER materialization: history drives participation and
        # completed-event exclusion; checkpoint prevents a second skill replay.
        data.history.extend(deepcopy(snap.completions))
        self.engine.calibrate(data)
        return data

    def employee_data(self, snap, employee_id, *, base=None):
        data = self.data(snap) if base is None else copy(base)
        if base is not None:
            data.events = dict(base.events)
        # engine chooses the first future session. Filter only this employee's
        # completed occurrences, not the shared SQLite catalog or other users.
        for event_id in self.engine.RECURRING:
            completed = {c["occurrence_key"] for c in snap.completions
                         if c["employee_id"] == employee_id and c["event_id"] == event_id}
            completed.update(h["date"] for h in snap.history if h["employee_id"] == employee_id
                             and h["event_id"] == event_id and h["status"] == "completed")
            if event_id in data.events:
                data.events[event_id] = dict(data.events[event_id])
                data.events[event_id]["upcoming_sessions"] = [s for s in data.events[event_id]["upcoming_sessions"] if s not in completed]
        return data

    def analyze(self, snap, employee_id):
        data = self.data(snap)
        return self.service.analyze_employee(data, employee_id)

    async def recommend(self, snap, employee_id, language):
        data = self.employee_data(snap, employee_id)
        return await self.service.get_recommendations(data, employee_id, language=language, state_revision=snap.state_revision)

    def overview(self, snap):
        data = self.data(snap)
        result = self.engine.hr_view(data)
        # hr_view uses a shared event catalog. Recheck affected employees against
        # their remaining club sessions so HR agrees with the recommendation API.
        affected = {c["employee_id"] for c in snap.completions if c["event_id"] in self.engine.RECURRING}
        affected.update(h["employee_id"] for h in snap.history
                        if h["event_id"] in self.engine.RECURRING and h["status"] == "completed"
                        and h["date"] in snap.events[h["event_id"]]["upcoming_sessions"])
        no_rec = {r["employee_id"]: r for r in result["no_recommendation"]}
        for employee_id in affected:
            personal = self.employee_data(snap, employee_id, base=data)
            recommendation = self.engine.recommend(personal, employee_id, k=1)
            no_rec.pop(employee_id, None)
            if not recommendation["recommendations"] and recommendation["gaps"]:
                employee = personal.employees[employee_id]
                no_rec[employee_id] = dict(employee_id=employee_id, role=employee["role"], grade=employee["grade"],
                                           open_gaps=list(recommendation["gaps"]), blocked_by_prereq=recommendation["blocked"])
        result["no_recommendation"] = [no_rec[e] for e in data.employees if e in no_rec]
        return result

    def validate_completion(self, snap, employee_id, event_id, occurrence_key):
        data = self.employee_data(snap, employee_id)
        # Ask the existing deterministic engine for ALL eligible candidates.
        # No LLM, duplicated prerequisites, ranking, or skill-gain calculation.
        result = self.engine.recommend(data, employee_id, k=len(data.events))
        candidate = next((r for r in result["recommendations"] if r["event_id"] == event_id), None)
        if candidate is None:
            blocked = any(r["event_id"] == event_id for r in result["blocked"])
            raise AppError("missing_prerequisites" if blocked else "activity_not_eligible",
                           "Activity is not an eligible development step", status=409)
        if event_id in self.engine.RECURRING and occurrence_key != candidate["next_session"]:
            raise AppError("invalid_occurrence", "Complete the next available club session", status=409)
