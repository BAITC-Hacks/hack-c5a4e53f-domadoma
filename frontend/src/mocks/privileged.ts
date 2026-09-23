import type { Employee, HrResponse, ProfileResponse } from '../api/types';
import { ApiError } from '../api/client';
import { demoEmployee } from './fixtures';
export const extraEmployees: Employee[] = [
  { employee_id: 'DEMO_DANIYAR', full_name: 'Данияр Омаров', role: 'Backend Engineer', grade: 'Junior' },
  { employee_id: 'DEMO_MADINA', full_name: 'Мадина Нурланова', role: 'Product Manager', grade: 'Middle' },
];
export function emptyDemoProfile(employee: Employee, state_revision: number): ProfileResponse {
  return { employee, target: { role: employee.role, grade: employee.grade, source: 'current_grade' },
    skills: [], readiness: { pct: 0, critical_met: 0, critical_total: 0 }, history: [], state_revision };
}
export function overview(revision: number): HrResponse {
  return { state_revision: revision,
    weak_skills: [{ skill_id: 'SK_SQL', name: 'SQL', employees: 1, critical_for: 1 }, { skill_id: 'SK_STATISTICS', name: 'Statistics', employees: 1, critical_for: 1 }],
    no_recommendation: extraEmployees.map(e => ({ employee_id: e.employee_id, role: e.role, grade: e.grade, open_gaps: 0, blocked_by_prereq: 0 })),
    participation: [{ event_id: 'EV_012', title: 'Advanced Python', completed: 1, total: 1, no_show: 0, declined: 0, dropped: 0 }],
  };
}
export async function readDemoImport(employees: File, history: File) {
  const read = (file: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsText(file);
  });
  let data;
  try { data = JSON.parse(await read(employees)); }
  catch { throw new ApiError(422, 'validation', 'Invalid JSON', [{ file: employees.name, field: 'employees', message: 'Expected valid JSON' }]); }
  const people = Array.isArray(data) ? data : data.employees ?? [data];
  if (!Array.isArray(people) || !people.length) throw new ApiError(422, 'validation', 'Empty employees');
  const result: Employee[] = [];
  for (const [index, person] of people.entries()) {
    for (const field of ['employee_id', 'full_name', 'role', 'grade']) {
      if (typeof person?.[field] !== 'string' || !person[field].trim()) throw new ApiError(422, 'validation', 'Invalid employee', [{ file: employees.name, row: index + 1, field, message: 'Required string' }]);
    }
    if (person.employee_id === demoEmployee.employee_id) throw new ApiError(422, 'demo_restriction', 'The demo account cannot be overwritten');
    result.push({ employee_id: person.employee_id, full_name: person.full_name, role: person.role, grade: person.grade });
  }
  const csv = await read(history);
  if (!csv.replace(/^\uFEFF/, '').split(/\r?\n/)[0].split(',').includes('record_id')) throw new ApiError(422, 'validation', 'Invalid CSV', [{ file: history.name, row: 1, field: 'record_id', message: 'Required CSV header' }]);
  // Demo mode validates the envelope only. Full CSV/domain validation belongs to backend.
  return result;
}
