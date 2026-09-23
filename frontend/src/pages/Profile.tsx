import { useEffect, useState, useSyncExternalStore } from 'react';
import { ArrowRight, ArrowUpRight, CheckCheck, Compass, Flag, Layers3, Target } from 'lucide-react';
import { ApiError, type ApiClient } from '../api/client';
import type { Language, User } from '../api/types';
import { EmployeeStore } from '../state/employee';
import { dateLabel, enumLabel, useI18n } from '../i18n';
import { Empty, ErrorPanel, Loading, PageHeading, StatusNotice } from '../components/common';
import { Recommendations } from '../components/Recommendations';
import { SkillsTable } from '../components/SkillsTable';

export function ProfilePage({ api, user, id, tab, onUnauthorized, minRevision = 0, onRevision }: { api: ApiClient; user: User; id: string; tab: string; onUnauthorized: () => void; minRevision?: number; onRevision?: (revision: number) => void }) {
  const { t, lang } = useI18n();
  const [store] = useState(() => new EmployeeStore(api, id, lang, minRevision));
  const state = useSyncExternalStore(store.subscribe, store.snapshot);
  useEffect(() => { void store.load(); return () => store.dispose(); }, [store]);
  useEffect(() => { void store.setLanguage(lang as Language); }, [store, lang]);
  useEffect(() => { if (state.profile) onRevision?.(state.profile.state_revision); }, [state.profile, onRevision]);
  useEffect(() => {
    if ([state.error, state.recommendationError].some(error => error instanceof ApiError && error.status === 401)) onUnauthorized();
  }, [state.error, state.recommendationError, onUnauthorized]);
  if (state.loading && !state.profile) return <Loading/>;
  if (!state.profile) return <ErrorPanel error={state.error} retry={() => { void store.load(); }}/>;
  const p = state.profile;
  const profileLink = (page: string) => '#' + page + (user.role === 'employee' ? '' : '/' + encodeURIComponent(id));
  const percent = Math.round(p.readiness.pct);
  const canComplete = user.role === 'admin' || (user.role === 'employee' && user.employee_id === id);
  return <>
    {user.role !== 'employee' && <div className="preview-note"><Compass size={16}/>{t('preview')} · {p.employee.full_name} · {id}</div>}
    <PageHeading title={tab === 'profile' ? t('hello') + ', ' + p.employee.full_name + ' 👋' : t(tab === 'skills' ? 'skills' : tab === 'history' ? 'history' : 'recommendations')} description={t(tab === 'profile' ? 'journeySubtitle' : tab === 'history' ? 'historySubtitle' : tab === 'skills' ? 'skillDescription' : 'recommendationsSubtitle')}/>
    <ErrorPanel error={state.error} retry={() => { void store.load(); }}/>
    {state.completionStatus && <StatusNotice>{t(state.completionStatus === 'completed' ? 'saved' : 'alreadyCompleted')}</StatusNotice>}
    {tab === 'profile' && <>
      <section className="goal-hero">
        <div className="goal-copy"><span className="eyebrow"><Target size={14}/>{t('goalLabel')}</span><h2>{p.target.grade} <span>{p.target.role}</span></h2><div className="career-transition"><span>{p.employee.grade}</span><span className="transition-line"><ArrowRight size={14}/></span><strong>{p.target.grade}</strong></div><p>{t('currentRole')}: {p.employee.role} · {p.employee.department ?? p.employee.grade}</p><a className="hero-link" href={profileLink('skills')}>{t('skillOverview')}<ArrowUpRight size={16}/></a></div>
        <div className="goal-progress"><div className="progress-ring"><svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="51" className="ring-bg"/><circle cx="60" cy="60" r="51" className="ring-value" pathLength="100" strokeDasharray={Math.max(0, Math.min(100, p.readiness.pct)) + ' 100'}/></svg><div><strong>{percent}%</strong><span>{t('coverage')}</span></div></div><p>{t('readinessNote')}</p></div>
      </section>
      <div className="stat-grid">
        <div className="stat-card"><span className="stat-icon peach"><Flag size={20}/></span><div><span>{t('criticalSkills')}</span><strong>{p.readiness.critical_met}<small> / {p.readiness.critical_total}</small></strong><p>{t('criticalNote')}</p></div></div>
        <div className="stat-card"><span className="stat-icon sage"><Layers3 size={20}/></span><div><span>{t('availableSteps')}</span><strong>{state.recommendations ? state.recommendations.recommendations.length : '—'}</strong><p>{t('availableNote')}</p></div></div>
        <div className="stat-card"><span className="stat-icon lilac"><CheckCheck size={20}/></span><div><span>{t('completed')}</span><strong>{p.history.filter(row => row.status === 'completed').length}</strong><p>{t('historyNote')}</p></div></div>
      </div>
    </>}
    {(tab === 'profile' || tab === 'recommendations') && <>
      {tab === 'profile' && <div className="section-heading"><div><h2>{t('nextStep')}</h2><p>{t('recommendationsSubtitle')}</p></div><a className="text-button" href={profileLink('recommendations')}>{t('allRecommendations')}<ArrowUpRight size={15}/></a></div>}
      <Recommendations state={state} store={store} canComplete={canComplete}/>
    </>}
    {(tab === 'profile' || tab === 'skills') && <section className="panel skill-panel"><div className="section-heading"><div><h2>{t('skillOverview')}</h2><p>{t('skillDescription')}</p></div>{tab === 'profile' && <a className="text-button" href={profileLink('skills')}>{t('allSkills')}<ArrowUpRight size={15}/></a>}</div><SkillsTable skills={tab === 'profile' ? p.skills.slice(0,4) : p.skills}/></section>}
    {(tab === 'skills' || tab === 'history') && <p className="source-note">{t('originalContent')}</p>}
    {tab === 'history' && <section className="panel">{!p.history.length ? <Empty title={t('emptyHistory')}/> : <div className="table-scroll"><table><thead><tr><th>{t('activity')}</th><th>{t('date')}</th><th>{t('status')}</th><th>{t('progress')}</th></tr></thead><tbody>{p.history.map((row, i) => <tr key={row.record_id ?? i}><td><strong>{row.title ?? row.event_id}</strong><small className="skill-id">{row.event_id}</small></td><td>{dateLabel(row.date, lang)}</td><td><span className={'badge ' + (row.status === 'completed' ? 'success' : 'neutral')}>{enumLabel(row.status, lang)}</span></td><td>{row.completion_pct}%</td></tr>)}</tbody></table></div>}</section>}
  </>;
}
