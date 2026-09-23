import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, ChartNoAxesCombined, ChevronRight, FlaskConical, History, Layers3, LogOut, Route, ShieldCheck, Sparkles, Upload, Users } from 'lucide-react';
import { ApiError, type ApiClient } from './api/client';
import type { ImportResponse, Language, User } from './api/types';
import { I18nContext, useI18n, type TextKey } from './i18n';
import { Brand, Empty, ErrorPanel, LanguagePicker } from './components/common';
import { Login } from './pages/Login';
import { ProfilePage } from './pages/Profile';
import { EmployeesPage, HrPage } from './pages/Management';
import { UploadPage } from './pages/Upload';

const personalLinks = [
  { path: 'profile', label: 'path', icon: Route },
  { path: 'skills', label: 'skills', icon: Layers3 },
  { path: 'recommendations', label: 'recommendations', icon: Sparkles },
  { path: 'history', label: 'history', icon: History },
] as const;
const managementLinks = [
  { path: 'hr', label: 'hr', icon: ChartNoAxesCombined },
  { path: 'employees', label: 'employees', icon: Users },
  { path: 'upload', label: 'upload', icon: Upload },
] as const;

function Workspace({ api }: { api: ApiClient }) {
  const { t } = useI18n();
  const [user, setUser] = useState<User | null>(null);
  const [expired, setExpired] = useState(false);
  const [hash, setHash] = useState(() => window.location.hash.slice(1));
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [minRevision, setMinRevision] = useState(0);
  const [cacheEpoch, setCacheEpoch] = useState(0);
  const session = useRef(0);
  const reportRevision = useCallback((revision: number) => {
    if (Number.isFinite(revision)) setMinRevision(previous => Math.max(previous, revision));
  }, []);
  // Successful writes must invalidate the active session even after their page unmounts.
  const scopedApi = useMemo<ApiClient>(() => {
    const generation = session.current;
    return {
      isMock: api.isMock,
      login: (username, password) => api.login(username, password), logout: () => api.logout(),
      me: () => api.me(), profile: id => api.profile(id),
      recommendations: (id, lang) => api.recommendations(id, lang),
      employees: () => api.employees(), overview: () => api.overview(),
      complete: async (...args) => {
        const result = await api.complete(...args);
        if (session.current === generation) reportRevision(result.profile.state_revision);
        return result;
      },
      upload: async (...args) => {
        const result = await api.upload(...args);
        if (session.current === generation) {
          reportRevision(result.state_revision);
          setCacheEpoch(epoch => epoch + 1);
        }
        return result;
      },
    };
  }, [api, user, reportRevision]);
  const navigate = useCallback((route: string) => { window.location.hash = route; setHash(route); }, []);
  useEffect(() => {
    const changed = () => setHash(window.location.hash.slice(1));
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);
  useEffect(() => { document.documentElement.scrollTop = 0; }, [hash]);
  const logout = useCallback((isExpired = false) => {
    session.current++;
    api.logout(); setUser(null); setExpired(isExpired); setPreviewId(null);
    setMinRevision(0); setCacheEpoch(epoch => epoch + 1); navigate('login');
  }, [api, navigate]);
  const onUnauthorized = useCallback(() => logout(true), [logout]);
  const onLogin = (account: User) => {
    session.current++;
    setUser(account); setExpired(false); setPreviewId(null);
    navigate(account.role === 'employee' ? 'profile' : 'hr');
  };
  const onOpen = (id: string) => { setPreviewId(id); navigate('profile/' + encodeURIComponent(id)); };
  const onImported = (result: ImportResponse) => {
    reportRevision(result.state_revision);
  };
  useEffect(() => {
    if (user && user.role !== 'employee' && hash.includes('/') && personalLinks.some(link => link.path === hash.split('/')[0])) {
      try { setPreviewId(decodeURIComponent(hash.slice(hash.indexOf('/') + 1))); } catch { /* malformed route is denied below */ }
    }
  }, [hash, user]);
  const banner = api.isMock && <div className="mock-banner" role="status"><FlaskConical size={15}/><strong>{t('demo')}</strong><span>{t('demoNote')}</span></div>;
  if (!user) return <>{banner}<Login api={api} onLogin={onLogin} expired={expired}/></>;

  const route = hash.split('/')[0] || (user.role === 'employee' ? 'profile' : 'hr');
  let requestedId: string | null = null;
  try { requestedId = hash.includes('/') ? decodeURIComponent(hash.slice(hash.indexOf('/') + 1)) : null; } catch { requestedId = ''; }
  const personal = personalLinks.some(link => link.path === route);
  const id = requestedId ?? (user.role === 'employee' ? user.employee_id : previewId);
  const privileged = user.role === 'hr' || user.role === 'admin';
  const denied = (!privileged && (['hr', 'employees', 'upload'].includes(route) || (personal && id !== user.employee_id))) || (route === 'upload' && user.role !== 'admin');
  const roleLabel = t(user.role === 'hr' ? 'hrRole' : user.role);
  const titleKey = [...personalLinks, ...managementLinks].find(link => link.path === route)?.label ?? 'workspace';
  function navLink(link: { path: string; label: TextKey; icon: typeof Route }) {
    const Icon = link.icon;
    const suffix = privileged && id && personalLinks.some(item => item.path === link.path) ? '/' + encodeURIComponent(id) : '';
    return <a key={link.path} className={'nav-link ' + (route === link.path ? 'active' : '')} href={'#' + link.path + suffix} aria-current={route === link.path ? 'page' : undefined}><Icon size={19}/><span>{t(link.label)}</span>{route === link.path && <ChevronRight size={15}/>}</a>;
  }
  return <>{banner}<div className="app-shell">
    <a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); document.getElementById('main-content')?.focus(); }}>{t('skipToContent')}</a>
    <aside className="sidebar"><Brand/><nav className="sidebar-nav" aria-label={t('workspace')}>
      <p className="nav-label">{t('workspace')}</p>{personalLinks.map(navLink)}
      {privileged && <><p className="nav-label">{t('management')}</p>{managementLinks.filter(link => link.path !== 'upload' || user.role === 'admin').map(navLink)}</>}
    </nav><div className="sidebar-bottom"><div className="sidebar-tip"><Sparkles size={22}/><strong>{t('fromSkills')}</strong><p>{t('clearReasons')}</p><ArrowUpRight size={18}/></div>
      <div className="sidebar-user"><span className="avatar">{user.role === 'employee' ? 'CQ' : user.role.toUpperCase()}</span><div><strong>{roleLabel}</strong><span className="user-role">{user.employee_id ?? user.user_id}</span></div></div>
      <button className="nav-link" onClick={() => logout()}><LogOut size={18}/>{t('logout')}</button>
    </div></aside>
    <div className="workspace-main"><header className="topbar"><div className="topbar-title">Career Quest <ChevronRight size={14}/><span>{t(titleKey)}</span></div><div className="topbar-meta"><span className="prototype-badge">HACKALEM · PROTOTYPE</span><LanguagePicker/><span className="avatar small" aria-hidden="true">CQ</span></div></header>
      <main id="main-content" className="app-content" tabIndex={-1}>
        {denied ? <ErrorPanel error={new ApiError(403, 'forbidden', 'Access denied')}/> : personal ? (
          id ? <ProfilePage key={id + ':' + cacheEpoch} api={scopedApi} user={user} id={id} tab={route} minRevision={minRevision} onRevision={reportRevision} onUnauthorized={onUnauthorized}/> : <Empty title={t('noOwnProfile')}/>
        ) : route === 'hr' ? <HrPage key={cacheEpoch} api={scopedApi} minRevision={minRevision} onUnauthorized={onUnauthorized}/> : route === 'employees' ? <EmployeesPage key={cacheEpoch} api={scopedApi} onUnauthorized={onUnauthorized} onOpen={onOpen}/> : route === 'upload' ? <UploadPage api={scopedApi} onUnauthorized={onUnauthorized} onImported={onImported} onOpen={onOpen} minRevision={minRevision}/> : <Empty title={t('pageNotFound')}/>}
      </main><footer className="app-footer"><span>{t('prototype')}</span><span><ShieldCheck size={13}/>{t('privateWorkspace')}</span></footer>
    </div>
  </div></>;
}

export default function App({ api }: { api: ApiClient }) {
  const [lang, setLang] = useState<Language>('ru');
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  return <I18nContext.Provider value={{ lang, setLang }}><Workspace api={api}/></I18nContext.Provider>;
}
