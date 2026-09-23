import { describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError, type ApiClient } from '../api/client';
import type { HrResponse } from '../api/types';
import { deferred, profile } from '../test/fixtures';
import { EmployeesPage, HrPage } from './Management';

const overview: HrResponse = {
  state_revision: 4,
  weak_skills: [{ skill_id: 'SK_SQL', name: 'SQL', employees: 8, critical_for: 3 }],
  no_recommendation: [{ employee_id: 'UNFAMILIAR_7', role: 'Analyst', grade: 'Middle', open_gaps: 2, blocked_by_prereq: 1 }],
  participation: [{ event_id: 'EV_X', title: 'SQL workshop', completed: 3, total: 5, no_show: 1, declined: 1, dropped: 0 }],
};
const apiWith = (methods: Partial<ApiClient>) => methods as ApiClient;

describe('management views', () => {
  it('shows HR sections with the participation denominator', async () => {
    render(<HrPage api={apiWith({ overview: vi.fn().mockResolvedValue(overview) })} onUnauthorized={vi.fn()} minRevision={1} />);
    expect(await screen.findByText('SK_SQL')).toBeInTheDocument();
    expect(screen.getByText('UNFAMILIAR_7')).toBeInTheDocument();
    expect(screen.getByText('3 / 5')).toBeInTheDocument();
    expect(screen.getByText(/всего записей участия по событию/)).toBeInTheDocument();
    expect(screen.getByRole('meter', { name: 'SQL workshop' })).toHaveAttribute('aria-valuemax', '5');
  });

  it('renders 403 without routing the user to login', async () => {
    const onUnauthorized = vi.fn();
    render(<HrPage api={apiWith({ overview: vi.fn().mockRejectedValue(new ApiError(403, 'forbidden', 'Forbidden')) })} onUnauthorized={onUnauthorized} minRevision={1} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Нет доступа');
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('rejects stale HR snapshots', async () => {
    render(<HrPage api={apiWith({ overview: vi.fn().mockResolvedValue(overview) })} onUnauthorized={vi.fn()} minRevision={5} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Данные обновились');
    expect(screen.queryByText('UNFAMILIAR_7')).not.toBeInTheDocument();
  });

  it('ignores a late unauthorized response after leaving the page', async () => {
    const pending = deferred<HrResponse>();
    const onUnauthorized = vi.fn();
    const { unmount } = render(<HrPage api={apiWith({ overview: () => pending.promise })} onUnauthorized={onUnauthorized} minRevision={1} />);
    unmount();
    await act(async () => pending.reject(new ApiError(401, 'expired', 'Expired')));
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('filters an authorized directory and opens the actual employee ID', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<EmployeesPage api={apiWith({ employees: vi.fn().mockResolvedValue({ employees: [profile.employee, { ...profile.employee, employee_id: 'ANOTHER', full_name: 'Other Person' }] }) })} onUnauthorized={vi.fn()} onOpen={onOpen} />);
    await screen.findByText('Test Person');
    await user.type(screen.getByRole('searchbox'), 'UNKNOWN_901');
    expect(screen.queryByText('Other Person')).not.toBeInTheDocument();
    await user.click(within(screen.getByRole('table')).getByRole('button', { name: /Открыть профиль/ }));
    expect(onOpen).toHaveBeenCalledWith('UNKNOWN_901');
  });
});
