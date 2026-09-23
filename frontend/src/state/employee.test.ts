import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../api/client';
import { EmployeeStore } from './employee';
import { deferred, profile, recommendations } from '../test/fixtures';

function api(overrides: Partial<ApiClient> = {}) {
  return {
    isMock: false, profile: vi.fn(async () => structuredClone(profile)),
    recommendations: vi.fn(async () => structuredClone(recommendations)),
    complete: vi.fn(async () => ({ status: 'completed', profile: { ...profile, state_revision: 2, readiness: { ...profile.readiness, pct: 75 } } })),
    ...overrides,
  } as unknown as ApiClient;
}
describe('profile state coordination', () => {
  it('does not display a profile older than the successful import revision', async () => {
    const client = api();
    const store = new EmployeeStore(client, 'UNKNOWN_901', 'ru', 3);
    await store.load();
    expect(store.snapshot().profile).toBeNull();
    expect(store.snapshot().error).toMatchObject({ code: 'stale' });
    expect(client.recommendations).not.toHaveBeenCalled();
  });
  it('replaces the profile from Complete before waiting for recommendations and rejects double clicks', async () => {
    const done = deferred<Awaited<ReturnType<ApiClient['complete']>>>();
    const fresh = deferred<typeof recommendations>();
    const client = api({ complete: vi.fn(() => done.promise) });
    const store = new EmployeeStore(client, 'UNKNOWN_901', 'ru');
    await store.load();
    client.recommendations = vi.fn(() => fresh.promise);
    const first = store.complete(recommendations.recommendations[0]);
    const second = store.complete(recommendations.recommendations[0]);
    expect(client.complete).toHaveBeenCalledTimes(1);
    expect(client.complete).toHaveBeenCalledWith('UNKNOWN_901', 'EV_036', '2026-10-08', expect.any(String));
    done.resolve({ status: 'completed', profile: { ...profile, state_revision: 2, readiness: { ...profile.readiness, pct: 79 } } });
    await first; await second;
    expect(store.snapshot().profile?.readiness.pct).toBe(79);
    expect(store.snapshot().recommendations).toBeNull();
    fresh.resolve({ ...recommendations, state_revision: 2 });
    await vi.waitFor(() => expect(store.snapshot().recommendations?.state_revision).toBe(2));
  });
  it('ignores a recommendations response with an old state_revision', async () => {
    const client = api({ profile: async () => ({ ...profile, state_revision: 5 }) });
    const store = new EmployeeStore(client, 'UNKNOWN_901', 'ru');
    await store.load();
    expect(store.snapshot().profile?.state_revision).toBe(5);
    expect(store.snapshot().recommendations).toBeNull();
    expect(store.snapshot().recommendationsLoading).toBe(false);
  });
  it('discards late language responses and retains the new language', async () => {
    const late = deferred<typeof recommendations>();
    const client = api({ recommendations: vi.fn((_id, lang) => lang === 'ru' ? late.promise : Promise.resolve({ ...recommendations, language: 'kk' as const })) });
    const store = new EmployeeStore(client, 'UNKNOWN_901', 'ru');
    const load = store.load();
    await vi.waitFor(() => expect(store.snapshot().profile).toBeTruthy());
    await store.setLanguage('kk');
    late.resolve(recommendations); await load;
    expect(store.snapshot().recommendations?.language).toBe('kk');
  });
  it('reuses the same idempotency key after an uncertain network failure', async () => {
    const complete = vi.fn().mockRejectedValueOnce(new Error('Network')).mockResolvedValueOnce({ status: 'already_completed', profile: { ...profile, state_revision: 2 } });
    const store = new EmployeeStore(api({ complete }), 'UNKNOWN_901', 'ru');
    await store.load();
    await store.complete(recommendations.recommendations[0]);
    await store.complete(recommendations.recommendations[0]);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[0][3]).toBe(complete.mock.calls[1][3]);
  });
  it('does not apply an in-flight response after disposal', async () => {
    const late = deferred<typeof profile>();
    const store = new EmployeeStore(api({ profile: () => late.promise }), 'UNKNOWN_901', 'ru');
    const load = store.load(); store.dispose();
    late.resolve(profile); await load;
    expect(store.snapshot().profile).toBeNull();
  });
});
