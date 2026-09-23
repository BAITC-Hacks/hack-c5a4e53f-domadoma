import type { ProfileResponse, RecommendationResponse } from '../api/types';
export const profile: ProfileResponse = {
  employee: { employee_id: 'UNKNOWN_901', full_name: 'Test Person', role: 'Data Analyst', grade: 'Middle' },
  target: { role: 'Data Analyst', grade: 'Senior', source: 'career_goal' },
  readiness: { pct: 50, critical_met: 0, critical_total: 1 },
  skills: [{ skill_id: 'SK_SQL', name: 'SQL', current: 2, required: 4, gap: 2, critical: true }],
  history: [], state_revision: 1,
};
export const recommendations: RecommendationResponse = {
  employee_id: 'UNKNOWN_901', language: 'ru', state_revision: 1, source: 'fallback', fallback_reason: 'unavailable',
  leader_override: false, duration_ms: 0, not_chosen: null, uncovered_critical: [], empty_reason: null,
  recommendations: [{
    event_id: 'EV_036', title: 'Public Speaking Club', type: 'meetup', format: 'offline', duration_hours: 2,
    next_session: '2026-10-08', score: 0.2, impact: 0.5, likelihood: 0.4, unlocks: [],
    closes: [{ skill_id: 'SK_SQL', name: 'SQL', from: 2, to: 3, required: 4, critical: true }],
    reasons: ['Target role', 'Skill gap', 'Available format'],
    reason_factors: [
      { fact_id: 'f1', type: 'target', values: { target_grade: 'Senior' } },
      { fact_id: 'f2', type: 'skill_gap', values: { current: 2, required: 4 } },
      { fact_id: 'f3', type: 'format', values: { format: 'offline' } },
    ],
  }],
};
export const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
