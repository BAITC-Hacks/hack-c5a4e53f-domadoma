import { useRef, useState, type FormEvent } from 'react';
import { ArrowRight, ArrowUpRight, Check, Layers3, LockKeyhole, Route, Sparkles, Target } from 'lucide-react';
import type { ApiClient } from '../api/client';
import { ApiError } from '../api/client';
import type { User } from '../api/types';
import { Brand, ErrorPanel, LanguagePicker } from '../components/common';
import { useI18n } from '../i18n';

export function Login({ api, onLogin, expired }: { api: ApiClient; onLogin: (user: User) => void; expired: boolean }) {
  const { t } = useI18n();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const lock = useRef(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(null);
    try { onLogin(await api.login(username.trim(), password)); }
    catch (error) { setError(error); }
    finally { lock.current = false; setBusy(false); }
  }
  return <div className="login-page">
    <section className="login-story">
      <Brand light />
      <div className="story-content"><span className="eyebrow">{t('loginEyebrow')}</span><h1>{t('loginHeadline').split('\n').map((line, i) => <span key={i}>{line}</span>)}</h1><p>{t('loginDescription')}</p>
        <div className="journey-art" aria-hidden="true">
          <svg viewBox="0 0 500 220" className="art-path"><path d="M35 180 C130 190 100 58 233 113 S370 190 452 28" /><circle cx="35" cy="180" r="7"/><circle cx="452" cy="28" r="7"/></svg>
          <div className="art-card art-card-one"><span><Layers3 size={21}/></span><div>{t('currentRole')}<strong>Middle</strong></div><Check size={16}/></div>
          <div className="art-card art-card-two"><span><Sparkles size={21}/></span><div>{t('nextStep')}<strong>SQL & BI</strong></div><ArrowUpRight size={17}/></div>
          <div className="art-card art-card-three"><Target size={22}/><div>{t('goal')}<strong>Senior</strong></div></div>
        </div>
        <div className="story-caption"><Route size={19}/><span>{t('personalRoute')}</span></div>
      </div>
      <div className="story-footer"><span>HackAlem 2026</span><span>Halyk Bank case</span></div>
    </section>
    <section className="login-form-side">
      <div className="login-top"><span className="prototype-badge">AI PROTOTYPE</span><LanguagePicker/></div>
      <div className="login-form-container"><div className="login-emblem"><ArrowUpRight size={28}/></div><h2>{t('welcome')}<span className="green-dot">.</span></h2><p className="login-subtitle">{t('signInDescription')}</p>
        {expired && <div className="error-panel" role="alert">{t('unauthorized')}</div>}
        {error instanceof ApiError && error.status === 401 ? <div className="error-panel" role="alert">{t('badCredentials')}</div> : <ErrorPanel error={error}/>}
        <form onSubmit={submit}>
          <label className="field">{t('username')}<input autoComplete="username" placeholder={t('usernamePlaceholder')} required value={username} onChange={e => setUsername(e.target.value)} disabled={busy}/></label>
          <label className="field">{t('password')}<input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} disabled={busy}/></label>
          <button className="button primary login-submit" disabled={busy}>{t(busy ? 'signingIn' : 'signIn')}<ArrowRight size={19}/></button>
        </form>
        {api.isMock && <div className="demo-accounts"><span className="mini-label">{t('demoAccounts')}</span><p>{t('demoCredentials')}</p></div>}
        <p className="session-note"><LockKeyhole size={14}/>{t('sessionNote')}</p>
      </div>
      <footer className="login-footer">{t('prototype')}</footer>
    </section>
  </div>;
}
