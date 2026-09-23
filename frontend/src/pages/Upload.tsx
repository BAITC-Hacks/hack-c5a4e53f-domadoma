import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowUpRight, FileJson, FileSpreadsheet, UploadCloud } from 'lucide-react';
import { ApiError, type ApiClient } from '../api/client';
import type { ImportResponse } from '../api/types';
import { ErrorPanel, PageHeading, StatusNotice } from '../components/common';
import { useI18n, type TextKey } from '../i18n';

type UploadProps = {
  api: ApiClient;
  onUnauthorized: () => void;
  onImported: (result: ImportResponse) => void;
  onOpen: (id: string) => void;
  minRevision: number;
};
const MAX_FILE_SIZE = 10 * 1024 * 1024;

export function UploadPage({ api, onUnauthorized, onImported, onOpen, minRevision }: UploadProps) {
  const { t } = useI18n();
  const [employees, setEmployees] = useState<File | null>(null);
  const [history, setHistory] = useState<File | null>(null);
  const [validation, setValidation] = useState<TextKey | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<ImportResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const active = useRef(true);
  const revision = useRef(minRevision);
  const callbacks = useRef({ onUnauthorized, onImported });
  revision.current = minRevision;
  callbacks.current = { onUnauthorized, onImported };
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked.current) return;
    setValidation(null); setError(null); setResult(null);
    if (!employees || !history) { setValidation('missingFiles'); return; }
    if (!/\.json$/i.test(employees.name) || !/\.csv$/i.test(history.name)) { setValidation('badFileType'); return; }
    if (employees.size > MAX_FILE_SIZE || history.size > MAX_FILE_SIZE) { setValidation('fileTooLarge'); return; }
    locked.current = true;
    setBusy(true);
    try {
      const response = await api.upload(employees, history);
      if (!active.current) return;
      if (response.state_revision < revision.current) throw new ApiError(409, 'stale', 'Stale import result');
      setResult(response);
      callbacks.current.onImported(response);
    } catch (reason) {
      if (!active.current) return;
      if (reason instanceof ApiError && reason.status === 401) callbacks.current.onUnauthorized();
      else setError(reason);
    } finally {
      locked.current = false;
      if (active.current) setBusy(false);
    }
  }

  return <>
    <PageHeading title={t('upload')} description={t('uploadSubtitle')} />
    {api.isMock && <p className="source-note fallback-note">{t('demoImportNote')}</p>}
    <section className="panel">
      <form onSubmit={submit} noValidate aria-busy={busy}>
        <div className="file-grid">
          <div className="file-card">
            <div className="file-card-heading"><FileJson size={25} /><span className="badge neutral">JSON</span></div>
            <label htmlFor="employees-file">{t('profilesFile')}</label>
            <input className="file-input" id="employees-file" type="file" accept=".json,application/json" disabled={busy} onChange={event => { setEmployees(event.target.files?.[0] ?? null); setValidation(null); setError(null); }} />
            <p className="file-selected">{employees?.name ?? t('fileNotSelected')}</p>
          </div>
          <div className="file-card">
            <div className="file-card-heading"><FileSpreadsheet size={25} /><span className="badge neutral">CSV</span></div>
            <label htmlFor="history-file">{t('historyFile')}</label>
            <input className="file-input" id="history-file" type="file" accept=".csv,text/csv" disabled={busy} onChange={event => { setHistory(event.target.files?.[0] ?? null); setValidation(null); setError(null); }} />
            <p className="file-selected">{history?.name ?? t('fileNotSelected')}</p>
          </div>
        </div>
        {validation && <p className="error-panel" role="alert">{t(validation)}</p>}
        <ErrorPanel error={error} />
        <div className="upload-actions"><p className="fine-print">{t('uploadInfo')}</p><button type="submit" className="button primary" disabled={busy}><UploadCloud size={18} />{t(busy ? 'uploading' : 'uploadAction')}</button></div>
      </form>
    </section>
    {result && <section className="panel" aria-label={t('importSuccess')}>
      <StatusNotice>{t('importSuccess')}</StatusNotice>
      <dl className="import-stats">
        <div className="import-stat"><dt>{t('importedEmployees')}</dt><dd>{result.employees_upserted}</dd></div>
        <div className="import-stat"><dt>{t('importedHistory')}</dt><dd>{result.history_imported}</dd></div>
        <div className="import-stat"><dt>{t('skipped')}</dt><dd>{result.history_duplicates_skipped}</dd></div>
      </dl>
      <div className="import-profiles">{result.employee_ids.map(id => <button className="button secondary" key={id} onClick={() => onOpen(id)}>{t('openProfile')}: {id}<ArrowUpRight size={16} /></button>)}</div>
    </section>}
  </>;
}
