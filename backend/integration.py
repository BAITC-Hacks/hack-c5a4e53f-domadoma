"""Domain boundary. No skill/readiness formulas and no production mock fallback.

Data constructor is provisional until the teammate's engine is available.
Runtime completion hooks below are proposals documented in docs/backend.md.
"""
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
        factory = getattr(self.service, "data_from_snapshot", None)
        if factory:
            return factory(snap)
        if snap.completions:
            raise AppError("completion_adapter_unavailable", "AI runtime completion adapter is required", status=503)
        return self.engine.Data(skills=snap.skills, profiles=snap.profiles, employees=snap.employees,
                                events=snap.events, history=snap.history, as_of=snap.as_of)

    def analyze(self, snap, employee_id):
        return self.service.analyze_employee(self.data(snap), employee_id) if self.available else self.data(snap)

    async def recommend(self, snap, employee_id, language):
        data = self.data(snap)
        return await self.service.get_recommendations(data, employee_id, language=language, state_revision=snap.state_revision)

    def overview(self, snap):
        data = self.data(snap)
        return self.engine.hr_view(data)

    def validate_completion(self, snap, employee_id, event_id, occurrence_key):
        self.data(snap)
        if not callable(getattr(self.service, "data_from_snapshot", None)) or not callable(getattr(self.service, "validate_completion", None)):
            raise AppError("completion_adapter_unavailable", "AI completion hooks must be agreed and connected", status=503)
        self.service.validate_completion(self.data(snap), employee_id, event_id, occurrence_key)
