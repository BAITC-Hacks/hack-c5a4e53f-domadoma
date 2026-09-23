import { describe, expect, it, vi } from 'vitest';
import { HttpApiClient } from './http';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const account = { user_id: 'u1', role: 'employee', employee_id: 'E_UNKNOWN' };
function harness(extra: (url: string, options: RequestInit) => Response | Promise<Response> = () => json({})) {
  const fetcher = vi.fn(async (input: RequestInfo | URL, options: RequestInit = {}) => {
    const url = String(input);
    if (url.endsWith('/auth/login')) return json({ access_token: 'test-token', token_type: 'bearer', user: { ...account, role: 'admin' } });
    if (url.endsWith('/auth/me')) return json(account);
    return extra(url, options);
  });
  return { fetcher, client: new HttpApiClient(fetcher as typeof fetch, 15) };
}
describe('HTTP contract', () => {
  it('uses /auth/me authority and keeps bearer credentials out of browser storage', async () => {
    const { client, fetcher } = harness();
    expect(await client.login('employee', 'password')).toEqual(account);
    await client.profile('E_UNKNOWN');
    expect(fetcher.mock.calls[2][0]).toBe('/api/employees/E_UNKNOWN');
    expect(new Headers(fetcher.mock.calls[2][1]?.headers).get('Authorization')).toBe('Bearer test-token');
    expect(localStorage.length).toBe(0);
    client.logout();
    await client.profile('E_UNKNOWN');
    expect(new Headers(fetcher.mock.calls[3][1]?.headers).has('Authorization')).toBe(false);
  });
  it('encodes IDs and sends occurrence_key plus a stable Idempotency-Key', async () => {
    const { client, fetcher } = harness();
    await client.complete('ID /?', 'EV_036', '2026-10-05', 'repeatable-key');
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe('/api/employees/ID%20%2F%3F/activities/EV_036/complete');
    expect(new Headers(options?.headers).get('Idempotency-Key')).toBe('repeatable-key');
    expect(JSON.parse(String(options?.body))).toEqual({ occurrence_key: '2026-10-05' });
  });
  it('sends both import files in one multipart request without overriding its boundary', async () => {
    const { client, fetcher } = harness();
    await client.upload(new File(['{}'], 'people.json'), new File(['csv'], 'history.csv'));
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe('/api/admin/upload');
    expect((options?.body as FormData).get('employees_file')).toBeInstanceOf(File);
    expect((options?.body as FormData).get('history_file')).toBeInstanceOf(File);
    expect(new Headers(options?.headers).has('Content-Type')).toBe(false);
  });
  it.each([401, 403, 422])('preserves structured %s error details without falling back to mocks', async (status) => {
    const { client } = harness(() => json({ error: { code: 'invalid', message: 'Rejected', details: [{ file: 'history.csv', row: 4, field: 'event_id', message: 'Unknown event' }] } }, status));
    await expect(client.overview()).rejects.toMatchObject({ status, code: 'invalid', details: [{ row: 4, field: 'event_id' }] });
  });
  it('enforces the deadline even when fetch stalls', async () => {
    const fetcher = vi.fn((_input, options: RequestInit) => new Promise<Response>((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    const client = new HttpApiClient(fetcher as typeof fetch, 5);
    await expect(client.me()).rejects.toMatchObject({ code: 'timeout', status: 0 });
  });
  it('requests the selected language explicitly', async () => {
    const { client, fetcher } = harness();
    await client.recommendations('NEW', 'kk');
    expect(fetcher.mock.calls[0][0]).toBe('/api/employees/NEW/recommendations?lang=kk');
  });
});
