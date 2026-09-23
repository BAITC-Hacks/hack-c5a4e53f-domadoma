export type Language = 'ru' | 'kk' | 'en';
export type Role = 'employee' | 'hr' | 'admin';
export interface User { user_id: string; role: Role; employee_id: string | null }
export interface Employee { employee_id: string; full_name: string; role: string; grade: string; department?: string; preferred_language?: Language }
export interface Skill { skill_id: string; name: string; current: number; required: number | null; gap: number; critical: boolean }
export interface HistoryRow { record_id: string; event_id: string; title: string; date: string; status: string; completion_pct: number; score: number | null; feedback_rating?: number | null; due_date?: string | null; assigned_by?: string }
export interface ProfileResponse {
  employee: Employee; target: { role: string; grade: string; source: 'career_goal' | 'next_grade' | 'current_grade' };
  readiness: { pct: number; critical_met: number; critical_total: number };
  skills: Skill[]; history: HistoryRow[]; state_revision: number;
}
export interface Recommendation {
  event_id: string; title: string; type: string; format: string; duration_hours: number;
  next_session: string | null; score: number; impact: number; likelihood: number;
  closes: { skill_id: string; name: string; from: number; to: number; required: number; critical: boolean }[];
  unlocks: unknown[]; prerequisites?: Record<string, number>;
  reasons: string[]; reason_factors: { fact_id: string; type: string; values: Record<string, unknown> }[];
}
export interface RecommendationResponse {
  employee_id: string; language: Language; state_revision: number; source: 'llm' | 'fallback';
  fallback_reason: string | null; leader_override: boolean; duration_ms: number;
  recommendations: Recommendation[]; not_chosen: { skill_id: string; text: string } | null;
  uncovered_critical: string[]; empty_reason: 'target_covered' | 'no_eligible_events' | 'missing_prerequisites' | 'catalog_gap' | null;
}
export interface HrResponse {
  state_revision: number;
  weak_skills: { skill_id: string; name: string; employees: number; critical_for: number }[];
  no_recommendation: { employee_id: string; role: string; grade: string; open_gaps: number; blocked_by_prereq: number }[];
  participation: { event_id?: string; title: string; completed: number; total: number; no_show: number; declined: number; dropped: number }[];
}
export interface ImportResponse { employee_ids: string[]; employees_upserted: number; history_imported: number; history_duplicates_skipped: number; state_revision: number }
export interface CompleteResponse { status: 'completed' | 'already_completed'; profile: ProfileResponse }
export interface ErrorDetail { file?: string; row?: number; field?: string; message: string }
