import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { HttpApiClient } from './api/http';
import type { Role } from './api/types';
import { deferred, profile, recommendations } from './test/fixtures';

beforeEach(() => { window.location.hash = ''; });
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
function mount(role: Role = 'employee', override?: (url: string, init: RequestInit) => Response | Promise<Response> | undefined) {
  let revision = 1;
  const fetcher = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const special = override?.(url, init); if (special) return special;
    if (url.endsWith('/auth/login')) return json({ access_token: 'token', token_type: 'bearer' });
    if (url.endsWith('/auth/me')) return json({ user_id: 'user', role, employee_id: role === 'employee' ? 'UNKNOWN_901' : null });
    if (url.endsWith('/complete')) { revision = 2; return json({ status: 'completed', profile: { ...profile, state_revision: 2, readiness: { ...profile.readiness, pct: 79 } } }); }
    if (url.includes('/recommendations')) return json({ ...recommendations, state_revision: revision, language: url.includes('lang=kk') ? 'kk' : 'ru' });
    if (url.endsWith('/hr/overview')) return json({ state_revision: revision, weak_skills: [], no_recommendation: [], participation: [] });
    if (url.endsWith('/employees')) return json({ employees: [profile.employee] });
    return json({ ...profile, state_revision: revision });
  });
  render(<App api={new HttpApiClient(fetcher as typeof fetch)} />);
  return { fetcher, user: userEvent.setup() };
}
async function signIn(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Логин'), 'employee');
  await user.type(screen.getByLabelText('Пароль'), 'demo123');
  await user.click(screen.getByRole('button', { name: 'Войти в Career Quest' }));
}
describe('user journeys against the HTTP boundary', () => {
  it('refreshes HR when import completes after leaving the upload page', async () => {
    const upload = deferred<Response>();
    let revision = 1;
    const { user } = mount('admin', url => {
      if (url.endsWith('/admin/upload')) return upload.promise;
      if (url.endsWith('/hr/overview')) return json({ state_revision: revision, weak_skills: [{ skill_id: 'SK_SQL', name: revision === 1 ? 'Before import' : 'After import', employees: 1, critical_for: 1 }], no_recommendation: [], participation: [] });
    });
    await signIn(user);
    await user.click(await screen.findByRole('link', { name: 'Импорт данных' }));
    await user.upload(screen.getByLabelText('Профили сотрудников'), new File(['{}'], 'p.json', { type: 'application/json' }));
    await user.upload(screen.getByLabelText('История участия'), new File(['record_id'], 'h.csv', { type: 'text/csv' }));
    await user.click(screen.getByRole('button', { name: 'Проверить и импортировать' }));
    await user.click(screen.getByRole('link', { name: 'Обзор команды' }));
    expect(await screen.findByText('Before import')).toBeInTheDocument();
    revision = 7;
    await act(async () => upload.resolve(json({ employee_ids: ['NEW'], employees_upserted: 1, history_imported: 0, history_duplicates_skipped: 0, state_revision: 7 })));
    expect(await screen.findByText('After import')).toBeInTheDocument();
  });
  it('preserves the employee ID on personal tabs reached from an explicit preview route', async () => {
    const { user } = mount('admin', url => {
      if (url === '/api/employees/ARBITRARY') return json({ ...profile, employee: { ...profile.employee, employee_id: 'ARBITRARY', full_name: 'Preview Person' } });
      if (url.includes('/ARBITRARY/recommendations')) return json({ ...recommendations, employee_id: 'ARBITRARY' });
    });
    await signIn(user);
    act(() => { window.location.hash = 'profile/ARBITRARY'; window.dispatchEvent(new HashChangeEvent('hashchange')); });
    await screen.findByText('Привет, Preview Person 👋');
    await user.click(screen.getByRole('link', { name: 'Мои навыки' }));
    expect(await screen.findByText('SK_SQL')).toBeInTheDocument();
    expect(window.location.hash).toBe('#skills/ARBITRARY');
  });
  it('refreshes HR when Complete finishes after leaving an employee preview', async () => {
    const completion = deferred<Response>();
    let revision = 1;
    const { user } = mount('admin', url => {
      if (url.endsWith('/complete')) return completion.promise;
      if (url.endsWith('/hr/overview')) return json({ state_revision: revision, weak_skills: [{ skill_id: 'SK_SQL', name: revision === 1 ? 'Before completion' : 'After completion', employees: 1, critical_for: 1 }], no_recommendation: [], participation: [] });
    });
    await signIn(user);
    act(() => { window.location.hash = 'profile/UNKNOWN_901'; window.dispatchEvent(new HashChangeEvent('hashchange')); });
    await user.click(await screen.findByRole('button', { name: 'Отметить выполнение' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Да, выполнено' }));
    // Simulate browser Back/navigation while the modal request remains in flight.
    act(() => { window.location.hash = 'hr'; window.dispatchEvent(new HashChangeEvent('hashchange')); });
    expect(await screen.findByText('Before completion')).toBeInTheDocument();
    revision = 2;
    await act(async () => completion.resolve(json({ status: 'completed', profile: { ...profile, state_revision: revision } })));
    expect(await screen.findByText('After completion')).toBeInTheDocument();
  });
  it('runs admin import → unknown profile → Complete → fresh recommendations → HR via HttpApiClient', async () => {
    let revision = 1;
    let done = false;
    const importedId = 'JURY-new /42';
    const newProfile = () => ({ ...profile, employee: { ...profile.employee, employee_id: importedId }, state_revision: revision, readiness: { ...profile.readiness, pct: done ? 79 : 50 } });
    const { user, fetcher } = mount('admin', url => {
      if (url.endsWith('/admin/upload')) { revision = 7; return json({ employee_ids: [importedId], employees_upserted: 1, history_imported: 3, history_duplicates_skipped: 0, state_revision: revision }); }
      if (url.endsWith('/hr/overview')) return json({ state_revision: revision, weak_skills: [], no_recommendation: [], participation: [{ title: 'Jury workshop', completed: done ? 1 : 0, total: 1, no_show: 0, declined: 0, dropped: 0 }] });
      if (url.endsWith('/complete')) { done = true; revision = 8; return json({ status: 'completed', profile: newProfile() }); }
      if (url.includes('/recommendations')) return json({ ...recommendations, employee_id: importedId, state_revision: revision, recommendations: done ? [] : recommendations.recommendations, empty_reason: done ? 'catalog_gap' : null });
      if (url === '/api/employees/' + encodeURIComponent(importedId)) return json(newProfile());
      return undefined;
    });
    await signIn(user);
    await user.click(await screen.findByRole('link', { name: 'Импорт данных' }));
    await user.upload(screen.getByLabelText('Профили сотрудников'), new File(['{}'], 'jury.json', { type: 'application/json' }));
    await user.upload(screen.getByLabelText('История участия'), new File(['record_id'], 'jury.csv', { type: 'text/csv' }));
    await user.click(screen.getByRole('button', { name: 'Проверить и импортировать' }));
    await user.click(await screen.findByRole('button', { name: 'Открыть профиль: ' + importedId }));
    await user.click(await screen.findByRole('button', { name: 'Отметить выполнение' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Да, выполнено' }));
    expect(await screen.findByText('79%')).toBeInTheDocument();
    expect(await screen.findByText('В текущем каталоге нет активностей для этих разрывов.')).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Обзор команды' }));
    expect(await screen.findByText('1 / 1')).toBeInTheDocument();
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes('/recommendations'))).toHaveLength(2);
    expect(screen.queryByText('Демо-режим · тестовые данные')).not.toBeInTheDocument();
  });
  it('shows a readable 403 and never exposes employee management routes', async () => {
    const { user, fetcher } = mount('employee', url => url.includes('/recommendations') ? json({ error: { code: 'forbidden', message: 'No access', details: [] } }, 403) : undefined);
    await signIn(user);
    expect(await screen.findByText('Нет доступа к этому разделу.')).toBeInTheDocument();
    window.location.hash = 'upload';
    await waitFor(() => expect(screen.queryByText('С чего начнём?')).not.toBeInTheDocument());
    expect(screen.queryByLabelText('Профили сотрудников')).not.toBeInTheDocument();
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('/admin/'))).toBe(false);
  });
  it('shows timeout as an error without silently switching to demo mode', async () => {
    const { user } = mount('employee', url => url.includes('/recommendations') ? json({ error: { code: 'timeout', message: 'Timeout', details: [] } }, 504) : undefined);
    await signIn(user);
    expect(await screen.findByText('Сервер не ответил вовремя. Повтори запрос.')).toBeInTheDocument();
    expect(screen.queryByText('Демо-режим · тестовые данные')).not.toBeInTheDocument();
  });
  it('keeps employee navigation private and shows a labeled fallback', async () => {
    const { user, fetcher } = mount();
    await signIn(user);
    expect(await screen.findByText('Test Person', { exact: false })).toBeInTheDocument();
    expect(await screen.findByText('AI недоступен — расчёт и шаблонное объяснение')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Обзор команды' })).not.toBeInTheDocument();
    expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('/employees') || String(url).includes('/hr/'))).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Выйти' }));
    expect(screen.getByLabelText('Пароль')).toBeInTheDocument();
    expect(screen.queryByText('Public Speaking Club')).not.toBeInTheDocument();
  });
  it('requires confirmation and replaces numbers with the completion response', async () => {
    const { user, fetcher } = mount();
    await signIn(user);
    await user.click(await screen.findByRole('button', { name: 'Отметить выполнение' }));
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/complete'))).toHaveLength(0);
    await user.dblClick(within(screen.getByRole('dialog')).getByRole('button', { name: 'Да, выполнено' }));
    expect(await screen.findByText('79%')).toBeInTheDocument();
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/complete'))).toHaveLength(1);
  });
  it('switches UI language and requests the same employee in Kazakh', async () => {
    const { user, fetcher } = mount();
    await signIn(user);
    await screen.findByText('Public Speaking Club');
    await user.selectOptions(screen.getByLabelText('Language'), 'kk');
    expect(screen.getByRole('link', { name: 'Менің жолым' })).toBeInTheDocument();
    await waitFor(() => expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('recommendations?lang=kk'))).toBe(true));
    expect(await screen.findByText('Public Speaking Club')).toBeInTheDocument();
  });
  it('renders empty recommendations with their reason', async () => {
    const { user } = mount('employee', url => url.includes('/recommendations') ? json({ ...recommendations, recommendations: [], empty_reason: 'missing_prerequisites' }) : undefined);
    await signIn(user);
    expect(await screen.findByText('Сначала нужно выполнить требования для участия.')).toBeInTheDocument();
  });
  it('returns to login on 401 and preserves a readable session message', async () => {
    const { user } = mount('employee', url => url.includes('/employees/') ? json({ error: { code: 'expired', message: 'Expired', details: [] } }, 401) : undefined);
    await signIn(user);
    expect(await screen.findByText('Сессия истекла. Войди снова.')).toBeInTheDocument();
    expect(screen.getByLabelText('Пароль')).toBeInTheDocument();
  });
  it('shows file/row/field import errors, then opens the arbitrary ID returned by the server', async () => {
    let failed = true;
    const { user, fetcher } = mount('admin', url => {
      if (!url.endsWith('/admin/upload')) return undefined;
      if (failed) return json({ error: { code: 'validation', message: 'Invalid history', details: [{ file: 'history.csv', row: 7, field: 'event_id', message: 'Unknown event' }] } }, 422);
      return json({ employee_ids: ['IMPORTED_RANDOM_42'], employees_upserted: 1, history_imported: 2, history_duplicates_skipped: 0, state_revision: 3 });
    });
    await signIn(user);
    await user.click(await screen.findByRole('link', { name: 'Импорт данных' }));
    await user.upload(screen.getByLabelText('Профили сотрудников'), new File(['{}'], 'people.json', { type: 'application/json' }));
    await user.upload(screen.getByLabelText('История участия'), new File(['csv'], 'history.csv', { type: 'text/csv' }));
    await user.click(screen.getByRole('button', { name: 'Проверить и импортировать' }));
    expect(await screen.findByText(/Unknown event/)).toBeInTheDocument();
    expect(within(screen.getByRole('alert')).getByText(/history.csv/)).toHaveTextContent('7');
    failed = false;
    await user.click(screen.getByRole('button', { name: 'Проверить и импортировать' }));
    await user.click(await screen.findByRole('button', { name: /IMPORTED_RANDOM_42/ }));
    await waitFor(() => expect(fetcher.mock.calls.some(([url]) => String(url) === '/api/employees/IMPORTED_RANDOM_42')).toBe(true));
  });
});
