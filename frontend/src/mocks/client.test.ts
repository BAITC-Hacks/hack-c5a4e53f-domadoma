import { describe, expect, it, vi } from 'vitest';
import { MockApiClient } from './client';

describe('explicit development fixtures', () => {
  it('blocks employee directory, HR data, other profiles and uploads', async () => {
    const api = new MockApiClient();
    await api.login('employee', 'demo123');
    for (const request of [() => api.employees(), () => api.overview(), () => api.profile('OTHER'), () => api.upload(new File(['{}'], 'e.json'), new File([''], 'h.csv'))]) {
      await expect(request()).rejects.toMatchObject({ status: 403 });
    }
  });
  it('preserves snapshot ordering across languages and makes completion idempotent', async () => {
    const api = new MockApiClient();
    const user = await api.login('employee', 'demo123');
    const id = user.employee_id!;
    const ru = await api.recommendations(id, 'ru');
    const kk = await api.recommendations(id, 'kk');
    expect(ru.recommendations.map(r => r.event_id)).toEqual(kk.recommendations.map(r => r.event_id));
    expect(kk.recommendations[0].reasons).not.toEqual(ru.recommendations[0].reasons);
    const result = await api.complete(id, 'EV_022', null, 'same');
    const repeated = await api.complete(id, 'EV_022', null, 'same');
    expect(repeated.status).toBe('already_completed');
    expect(repeated.profile).toEqual(result.profile);
    expect((await api.recommendations(id, 'ru')).recommendations.some(r => r.event_id === 'EV_022')).toBe(false);
  });
  it('does not let an in-flight login restore a logged-out session', async () => {
    vi.useFakeTimers();
    try {
      const api = new MockApiClient();
      const login = api.login('admin', 'demo123');
      const assertion = expect(login).rejects.toMatchObject({ code: 'cancelled' });
      api.logout();
      await vi.runAllTimersAsync();
      await assertion;
      const me = expect(api.me()).rejects.toMatchObject({ status: 401 });
      await vi.runAllTimersAsync(); await me;
    } finally { vi.useRealTimers(); }
  });
});
