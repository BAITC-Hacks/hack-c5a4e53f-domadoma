import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError, type ApiClient } from '../api/client';
import type { ImportResponse } from '../api/types';
import { deferred } from '../test/fixtures';
import { UploadPage } from './Upload';

const result: ImportResponse = { employee_ids: ['NEW_UNKNOWN_928'], employees_upserted: 1, history_imported: 3, history_duplicates_skipped: 2, state_revision: 7 };
function mount(upload: ApiClient['upload'], minRevision = 1) {
  const onImported = vi.fn(), onOpen = vi.fn(), onUnauthorized = vi.fn();
  const view = render(<UploadPage api={{ upload } as ApiClient} onImported={onImported} onOpen={onOpen} onUnauthorized={onUnauthorized} minRevision={minRevision} />);
  return { ...view, onImported, onOpen, onUnauthorized, user: userEvent.setup() };
}
async function chooseFiles(user: ReturnType<typeof userEvent.setup>) {
  await user.upload(screen.getByLabelText('Профили сотрудников'), new File(['{}'], 'people.json', { type: 'application/json' }));
  await user.upload(screen.getByLabelText('История участия'), new File(['csv'], 'history.csv', { type: 'text/csv' }));
}

describe('administrator upload', () => {
  it('requires both files before sending anything', async () => {
    const upload = vi.fn();
    const { user } = mount(upload);
    await user.click(screen.getByRole('button', { name: 'Проверить и импортировать' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Выбери JSON');
    expect(upload).not.toHaveBeenCalled();
  });

  it('rejects an incorrect extension before the upload request', async () => {
    const upload = vi.fn();
    const { user } = mount(upload);
    await chooseFiles(user);
    fireEvent.change(screen.getByLabelText('Профили сотрудников'), { target: { files: [new File(['{}'], 'people.txt')] } });
    await user.click(screen.getByRole('button', { name: 'Проверить и импортировать' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Ожидаются файлы .json и .csv');
    expect(upload).not.toHaveBeenCalled();
  });

  it('rejects files larger than the stated client limit', async () => {
    const upload = vi.fn();
    const { user } = mount(upload);
    await chooseFiles(user);
    const largeFile = new File(['{}'], 'large.json');
    Object.defineProperty(largeFile, 'size', { value: 10 * 1024 * 1024 + 1 });
    fireEvent.change(screen.getByLabelText('Профили сотрудников'), { target: { files: [largeFile] } });
    await user.click(screen.getByRole('button', { name: 'Проверить и импортировать' }));
    expect(screen.getByRole('alert')).toHaveTextContent('10 МБ');
    expect(upload).not.toHaveBeenCalled();
  });

  it('locks duplicate submissions and preserves returned IDs for preview', async () => {
    const pending = deferred<ImportResponse>();
    const upload = vi.fn(() => pending.promise);
    const { user, onImported, onOpen } = mount(upload);
    await chooseFiles(user);
    const submit = screen.getByRole('button', { name: 'Проверить и импортировать' });
    fireEvent.submit(submit.closest('form')!);
    fireEvent.submit(submit.closest('form')!);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Импортируем…' })).toBeDisabled();
    await act(async () => pending.resolve(result));
    expect(onImported).toHaveBeenCalledWith(result);
    expect(screen.getByText('Импорт завершён')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /NEW_UNKNOWN_928/ }));
    expect(onOpen).toHaveBeenCalledWith('NEW_UNKNOWN_928');
  });

  it('shows structured server validation errors without losing files', async () => {
    const upload = vi.fn().mockRejectedValue(new ApiError(422, 'validation', 'Invalid history', [{ file: 'history.csv', row: 7, field: 'event_id', message: 'Unknown event' }]));
    const { user } = mount(upload);
    await chooseFiles(user);
    await user.click(screen.getByRole('button', { name: 'Проверить и импортировать' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('history.csv · Строка 7 · event_id · Unknown event');
    expect((screen.getByLabelText('Профили сотрудников') as HTMLInputElement).files).toHaveLength(1);
  });

  it('does not invalidate caches using a stale import response', async () => {
    const { user, onImported } = mount(vi.fn().mockResolvedValue(result), 8);
    await chooseFiles(user);
    await user.click(screen.getByRole('button', { name: 'Проверить и импортировать' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Данные обновились');
    expect(onImported).not.toHaveBeenCalled();
  });

  it('returns control to auth when the upload receives 401', async () => {
    const { user, onUnauthorized, onImported } = mount(vi.fn().mockRejectedValue(new ApiError(401, 'expired', 'Expired')));
    await chooseFiles(user);
    await user.click(screen.getByRole('button', { name: 'Проверить и импортировать' }));
    await waitFor(() => expect(onUnauthorized).toHaveBeenCalledOnce());
    expect(onImported).not.toHaveBeenCalled();
  });

  it('ignores an import result after unmount', async () => {
    const pending = deferred<ImportResponse>();
    const upload = vi.fn(() => pending.promise);
    const { user, onImported, unmount } = mount(upload);
    await chooseFiles(user);
    await user.click(screen.getByRole('button', { name: 'Проверить и импортировать' }));
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    unmount();
    await act(async () => pending.resolve(result));
    expect(onImported).not.toHaveBeenCalled();
  });
});
