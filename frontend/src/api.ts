export type Role = "employee" | "hr" | "admin" | string;

export type User = {
  user_id: string;
  role: Role;
  employee_id: string | null;
};

export type Profile = {
  employee: {
    employee_id: string;
    full_name: string;
    department?: string;
    role: string;
    grade: string;
    preferred_language?: string;
  };
  target?: { role?: string; grade?: string; source?: string };
  readiness: { pct: number; critical_met: number; critical_total: number };
  skills: Array<{
    skill_id: string;
    name: string;
    current: number;
    required: number | null;
    gap: number;
    critical: boolean;
  }>;
  history: Array<Record<string, unknown>>;
  state_revision: number;
};

export type Recommendation = {
  event_id: string;
  title: string;
  type?: string;
  format?: string;
  duration_hours?: number;
  next_session?: string | null;
  score?: number;
  impact?: number;
  closes?: Array<{ name: string; from: number; to: number; required: number | null; critical: boolean }>;
  reasons?: string[];
};

export type Recommendations = {
  employee_id: string;
  language: string;
  source: "llm" | "fallback";
  fallback_reason?: string | null;
  state_revision: number;
  recommendations: Recommendation[];
};

export type HrOverview = {
  state_revision: number;
  weak_skills: Array<{ skill_id: string; name: string; employees: number; critical_for: string[] }>;
  no_recommendation: Array<{ employee_id: string; role: string; grade: string; open_gaps: string[]; blocked_by_prereq: string[] }>;
  participation: Array<Record<string, string | number>>;
};

export type Employee = { employee_id: string; full_name: string; role: string; grade: string };

async function request<T>(path: string, token: string, options: RequestInit = {}): Promise<T> {
  const auth: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: { ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }), ...auth, ...(options.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || body?.detail || `Ошибка API: ${response.status}`);
  return body as T;
}

export const api = {
  login: (username: string, password: string) => request<{ access_token: string; user: User }>("/auth/login", "", { method: "POST", body: JSON.stringify({ username, password }) }),
  me: (token: string) => request<User>("/auth/me", token),
  profile: (token: string, id: string) => request<Profile>(`/employees/${encodeURIComponent(id)}`, token),
  recommendations: (token: string, id: string, lang = "ru") => request<Recommendations>(`/employees/${encodeURIComponent(id)}/recommendations?lang=${lang}`, token),
  employees: (token: string) => request<{ employees: Employee[] }>("/employees", token),
  hrOverview: (token: string) => request<HrOverview>("/hr/overview", token),
  complete: (token: string, employeeId: string, eventId: string, occurrenceKey: string | null) => request<{ status: string; profile: Profile }>(`/employees/${encodeURIComponent(employeeId)}/activities/${encodeURIComponent(eventId)}/complete`, token, { method: "POST", headers: { "Idempotency-Key": `${employeeId}-${eventId}-${Date.now()}` }, body: JSON.stringify({ occurrence_key: occurrenceKey }) }),
  upload: (token: string, employeesFile: File, historyFile: File) => { const form = new FormData(); form.append("employees_file", employeesFile); form.append("history_file", historyFile); return request<{ employee_ids: string[]; employees_upserted: number; history_imported: number; history_duplicates_skipped: number; state_revision: number }>("/admin/upload", token, { method: "POST", body: form }); },
};
