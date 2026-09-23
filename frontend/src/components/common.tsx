import { useEffect, useRef, type ReactNode } from 'react';
import { AlertCircle, ArrowUpRight, Check, Compass, Globe2, LoaderCircle, X } from 'lucide-react';
import { ApiError } from '../api/client';
import { useI18n, type TextKey } from '../i18n';

export function Brand({ light = false }: { light?: boolean }) {
  return <div className={'brand ' + (light ? 'brand-light' : '')}><span className="brand-icon"><Compass size={25} strokeWidth={1.8} /></span><span>career<span className="brand-weight">quest</span><small>GROW WITH PURPOSE</small></span></div>;
}
export function LanguagePicker() {
  const { lang, setLang } = useI18n();
  return <label className="language-picker"><Globe2 size={16} /><select aria-label="Language" value={lang} onChange={e => setLang(e.target.value as typeof lang)}><option value="ru">Русский</option><option value="kk">Қазақша</option><option value="en">English</option></select></label>;
}
export function Loading({ small = false }: { small?: boolean }) {
  const { t } = useI18n();
  return <div className={'loading ' + (small ? 'loading-small' : '')} role="status"><LoaderCircle className="spin" size={22} /><span>{t(small ? 'refreshing' : 'loading')}</span></div>;
}
export function ErrorPanel({ error, retry }: { error: unknown; retry?: () => void }) {
  const { t } = useI18n();
  if (!error) return null;
  let key: TextKey = 'error';
  if (error instanceof ApiError) {
    key = error.status === 401 ? 'unauthorized' : error.status === 403 ? 'forbidden' :
      ({ timeout: 'timeout', network: 'network', stale: 'stale', invalid_response: 'invalidResponse' } as Record<string, TextKey>)[error.code] ?? 'error';
  }
  return <div className="error-panel" role="alert"><AlertCircle size={19} /><div><strong>{t(key)}</strong>
    {error instanceof ApiError && error.status === 422 && <p>{error.message}</p>}
    {error instanceof ApiError && error.details.length > 0 && <ul>{error.details.map((detail, i) => <li key={i}>{[detail.file, detail.row != null ? t('row') + ' ' + detail.row : '', detail.field, detail.message].filter(Boolean).join(' · ')}</li>)}</ul>}
    {retry && <button className="text-button" onClick={retry}>{t('retry')} <ArrowUpRight size={14} /></button>}
  </div></div>;
}
export function Empty({ title, description, icon }: { title: string; description?: string; icon?: ReactNode }) {
  return <div className="empty"><span className="empty-icon">{icon ?? <Compass size={25} />}</span><h3>{title}</h3>{description && <p>{description}</p>}</div>;
}
export function PageHeading({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <div className="page-heading"><div><h1>{title}</h1>{description && <p>{description}</p>}</div>{action}</div>;
}
export function StatusNotice({ children }: { children: ReactNode }) {
  return <div className="success-notice" role="status"><Check size={18} />{children}</div>;
}
export function ConfirmDialog({ title, children, busy, onClose, onConfirm }: { title: string; children: ReactNode; busy: boolean; onClose: () => void; onConfirm: () => void }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    cancel.current?.focus();
    return () => previous?.focus();
  }, []);
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
    <div ref={ref} className="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title" onKeyDown={e => {
      if (e.key === 'Escape' && !busy) onClose();
      if (e.key !== 'Tab') return;
      const targets = ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
      if (!targets?.length) { e.preventDefault(); return; }
      const first = targets[0], last = targets[targets.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }}>
      <button className="icon-button modal-close" aria-label={t('close')} disabled={busy} onClick={onClose}><X size={20} /></button>
      <span className="modal-symbol"><Check size={27} /></span><h2 id="confirm-title">{title}</h2>{children}
      <div className="modal-actions"><button ref={cancel} className="button secondary" disabled={busy} onClick={onClose}>{t('cancel')}</button><button className="button primary" disabled={busy} onClick={onConfirm}>{busy ? t('saving') : t('confirm')}</button></div>
    </div>
  </div>;
}
