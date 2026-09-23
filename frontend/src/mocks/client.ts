import { ApiError, type ApiClient } from '../api/client';
import type { Employee, Language, User } from '../api/types';
import { demoEmployee, demoProfile, demoRecommendations, eventBits } from './fixtures';

export class MockApiClient implements ApiClient {
  readonly isMock = true;
  private user: User | null = null;
  private generation = 0;
  private revision = 1;
  private mask = 0;
  private imported = new Map<string, Employee>();
  private async ready() {
    const generation = this.generation;
    await new Promise(resolve => setTimeout(resolve, 220));
    if (generation !== this.generation) throw new ApiError(0, 'cancelled', 'Session changed');
    if (!this.user) throw new ApiError(401, 'unauthorized', 'Sign in required');
    return this.user;
  }
  private async allowed(id?: string, write = false) {
    const user = await this.ready();
    if ((user.role === 'employee' && id !== user.employee_id) || (write && user.role === 'hr')) throw new ApiError(403, 'forbidden', 'Access denied');
    return user;
  }
  async login(username: string, password: string) {
    this.logout();
    const generation = this.generation;
    await new Promise(resolve => setTimeout(resolve, 250));
    if (generation !== this.generation) throw new ApiError(0, 'cancelled', 'Session changed');
    if (!['employee', 'hr', 'admin'].includes(username) || password !== 'demo123') throw new ApiError(401, 'invalid_credentials', 'Invalid credentials');
    this.user = { user_id: 'demo_' + username, role: username as User['role'], employee_id: username === 'employee' ? demoEmployee.employee_id : null };
    return this.me();
  }
  logout() { this.user = null; this.generation++; }
  me() { return this.ready(); }
  async profile(id: string) {
    await this.allowed(id);
    if (id === demoEmployee.employee_id) return demoProfile(this.mask, this.revision);
    const { extraEmployees, emptyDemoProfile } = await import('./privileged');
    const employee = this.imported.get(id) ?? extraEmployees.find(e => e.employee_id === id);
    if (!employee) throw new ApiError(404, 'not_found', 'Employee not found');
    return emptyDemoProfile(employee, this.revision);
  }
  async recommendations(id: string, lang: Language) {
    await this.allowed(id);
    if (id === demoEmployee.employee_id) return demoRecommendations(this.mask, this.revision, lang);
    await this.profile(id);
    return { ...demoRecommendations(7, this.revision, lang), employee_id: id };
  }
  async employees() {
    await this.allowed();
    const { extraEmployees } = await import('./privileged');
    const employees = new Map([demoEmployee, ...extraEmployees, ...this.imported.values()].map(e => [e.employee_id, e]));
    return { employees: [...employees.values()] };
  }
  async complete(id: string, eventId: string, occurrence: string | null, _key: string): ReturnType<ApiClient['complete']> {
    await this.allowed(id, true);
    if (id !== demoEmployee.employee_id || !eventBits[eventId]) throw new ApiError(422, 'demo_restriction', 'No completion fixture for this profile');
    if (eventId === 'EV_036' && occurrence !== '2026-10-08') throw new ApiError(422, 'validation', 'Invalid demo session');
    if (this.mask & eventBits[eventId]) return { status: 'already_completed', profile: demoProfile(this.mask, this.revision) };
    this.mask |= eventBits[eventId]; this.revision++;
    return { status: 'completed', profile: demoProfile(this.mask, this.revision) };
  }
  async overview() {
    await this.allowed();
    const { overview } = await import('./privileged');
    const value = overview(this.revision);
    if (this.mask & 1) value.weak_skills = value.weak_skills.filter(s => s.skill_id !== 'SK_SQL');
    if (this.mask & 2) value.weak_skills = value.weak_skills.filter(s => s.skill_id !== 'SK_STATISTICS');
    return value;
  }
  async upload(employees: File, history: File): ReturnType<ApiClient['upload']> {
    const generation = this.generation;
    const user = await this.ready();
    if (user.role !== 'admin') throw new ApiError(403, 'forbidden', 'Admin required');
    const { readDemoImport } = await import('./privileged');
    const people = await readDemoImport(employees, history);
    if (generation !== this.generation) throw new ApiError(0, 'cancelled', 'Session changed');
    people.forEach(person => this.imported.set(person.employee_id, person));
    this.revision++;
    return { employee_ids: people.map(e => e.employee_id), employees_upserted: people.length, history_imported: 0, history_duplicates_skipped: 0, state_revision: this.revision };
  }
}
