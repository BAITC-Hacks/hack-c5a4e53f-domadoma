import { ApiError, type ApiClient } from './client';
import type { Language, User } from './types';

export class HttpApiClient implements ApiClient {
  readonly isMock = false;
  private token: string | null = null;
  private generation = 0;
  constructor(private fetcher: typeof fetch = (...args) => fetch(...args), private timeout = 10000) {}

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const generation = this.generation;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    const headers = new Headers(options.headers);
    headers.set('Accept', 'application/json');
    if (this.token) headers.set('Authorization', 'Bearer ' + this.token);
    if (typeof options.body === 'string') headers.set('Content-Type', 'application/json');
    try {
      const response = await this.fetcher('/api' + path, { ...options, headers, signal: controller.signal, cache: 'no-store' });
      const body: unknown = await response.json().catch(() => null);
      if (generation !== this.generation) throw new ApiError(0, 'cancelled', 'Session changed');
      if (!response.ok) {
        if (response.status === 401) this.token = null;
        const error = (body as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
        throw new ApiError(response.status, error?.code ?? 'http_error', error?.message ?? 'Request failed',
          Array.isArray(error?.details) ? error.details.filter(d => d && typeof d.message === 'string') : []);
      }
      if (!body || typeof body !== 'object') throw new ApiError(response.status, 'invalid_response', 'Invalid JSON response');
      return body as T;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (controller.signal.aborted) throw new ApiError(0, 'timeout', 'Request timed out');
      throw new ApiError(0, 'network', 'Network unavailable');
    } finally { clearTimeout(timer); }
  }
  async login(username: string, password: string): Promise<User> {
    this.logout();
    const result = await this.request<{ access_token: string }>('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
    if (typeof result.access_token !== 'string' || !result.access_token) throw new ApiError(0, 'invalid_response', 'Missing token');
    this.token = result.access_token;
    try {
      const user = await this.me();
      if (!['employee', 'hr', 'admin'].includes(user.role) || (user.role === 'employee' && !user.employee_id)) {
        throw new ApiError(0, 'invalid_response', 'Invalid account');
      }
      return user;
    } catch (error) { this.logout(); throw error; }
  }
  logout() { this.token = null; this.generation++; }
  me(): ReturnType<ApiClient['me']> { return this.request('/auth/me'); }
  profile(id: string): ReturnType<ApiClient['profile']> { return this.request('/employees/' + encodeURIComponent(id)); }
  recommendations(id: string, lang: Language): ReturnType<ApiClient['recommendations']> { return this.request('/employees/' + encodeURIComponent(id) + '/recommendations?lang=' + lang); }
  employees(): ReturnType<ApiClient['employees']> { return this.request('/employees'); }
  complete(id: string, eventId: string, occurrenceKey: string | null, key: string): ReturnType<ApiClient['complete']> {
    return this.request('/employees/' + encodeURIComponent(id) + '/activities/' + encodeURIComponent(eventId) + '/complete', {
      method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify({ occurrence_key: occurrenceKey }),
    });
  }
  overview(): ReturnType<ApiClient['overview']> { return this.request('/hr/overview'); }
  upload(employees: File, history: File): ReturnType<ApiClient['upload']> {
    const body = new FormData();
    body.append('employees_file', employees);
    body.append('history_file', history);
    return this.request('/admin/upload', { method: 'POST', body });
  }
}
