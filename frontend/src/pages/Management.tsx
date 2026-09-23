import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, BarChart3, RefreshCw, Search, Users } from 'lucide-react';
import { ApiError, type ApiClient } from '../api/client';
import type { Employee, HrResponse } from '../api/types';
import { Empty, ErrorPanel, Loading, PageHeading } from '../components/common';
import { useI18n } from '../i18n';

type AccessProps = { api: ApiClient; onUnauthorized: () => void };

export function HrPage({ api, onUnauthorized, minRevision }: AccessProps & { minRevision: number }) {
  const { t } = useI18n();
  const [data, setData] = useState<HrResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const unauthorized = useRef(onUnauthorized);
  const revision = useRef(minRevision);
  unauthorized.current = onUnauthorized;
  revision.current = minRevision;

  useEffect(() => {
    let active = true;
    setLoading(true); setError(null); setData(null);
    void api.overview().then(response => {
      if (!active) return;
      if (response.state_revision < revision.current) throw new ApiError(409, 'stale', 'Stale overview');
      setData(response);
    }).catch(reason => {
      if (!active) return;
      if (reason instanceof ApiError && reason.status === 401) unauthorized.current();
      else setError(reason);
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, minRevision, refresh]);

  return <>
    <PageHeading title={t('hr')} description={t('hrSubtitle')} action={<button className="button secondary" onClick={() => setRefresh(value => value + 1)} disabled={loading}><RefreshCw size={16} />{t('refresh')}</button>} />
    {loading && <Loading />}
    <ErrorPanel error={error} retry={() => setRefresh(value => value + 1)} />
    {data && <>
      <div className="management-grid">
        <section className="panel" aria-labelledby="weak-skills-title">
          <div className="section-heading"><h2 id="weak-skills-title">{t('weakSkills')}</h2><BarChart3 size={20} /></div>
          {data.weak_skills.length === 0 ? <Empty title={t('noData')} /> : <div className="table-scroll"><table className="data-table">
            <thead><tr><th scope="col">{t('skill')}</th><th scope="col">{t('employeeCount')}</th><th scope="col">{t('criticalFor')}</th></tr></thead>
            <tbody>{data.weak_skills.map(skill => <tr key={skill.skill_id}><td><strong>{skill.name}</strong><small>{skill.skill_id}</small></td><td>{skill.employees}</td><td>{skill.critical_for}</td></tr>)}</tbody>
          </table></div>}
        </section>
        <section className="panel" aria-labelledby="no-candidates-title">
          <div className="section-heading"><h2 id="no-candidates-title">{t('noCandidates')}</h2><Users size={20} /></div>
          {data.no_recommendation.length === 0 ? <Empty title={t('noData')} /> : <div className="table-scroll"><table className="data-table">
            <thead><tr><th scope="col">{t('employee')}</th><th scope="col">{t('openGaps')}</th><th scope="col">{t('blocked')}</th></tr></thead>
            <tbody>{data.no_recommendation.map(employee => <tr key={employee.employee_id}><td><strong>{employee.employee_id}</strong><small>{employee.role} · {employee.grade}</small></td><td>{employee.open_gaps}</td><td>{employee.blocked_by_prereq}</td></tr>)}</tbody>
          </table></div>}
        </section>
      </div>
      <section className="panel" aria-labelledby="participation-title">
        <div className="section-heading"><h2 id="participation-title">{t('participation')}</h2></div>
        <p className="fine-print">{t('participationNote')}</p>
        {data.participation.length === 0 ? <Empty title={t('noData')} /> : <div className="participation-list">{data.participation.map((event, index) => <div className="participation-row" key={event.event_id ?? `${event.title}-${index}`}>
          <div><strong>{event.title}</strong>{event.event_id && <small>{event.event_id}</small>}<div className="participation-count">{t('completed')}: <b>{event.completed} / {event.total}</b></div></div>
          <div>
            <div className="participation-bar" role="meter" aria-label={event.title} aria-valuemin={0} aria-valuemax={event.total || 1} aria-valuenow={event.completed} aria-valuetext={`${event.completed} / ${event.total}`}><span style={{ width: `${event.total > 0 ? Math.min(100, Math.max(0, event.completed / event.total * 100)) : 0}%` }} /></div>
            <p className="fine-print">{t('no_show')}: {event.no_show} · {t('declined')}: {event.declined} · {t('dropped')}: {event.dropped}</p>
          </div>
        </div>)}</div>}
      </section>
      <p className="source-note">{t('originalContent')}</p>
    </>}
  </>;
}

export function EmployeesPage({ api, onUnauthorized, onOpen }: AccessProps & { onOpen: (id: string) => void }) {
  const { t } = useI18n();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const unauthorized = useRef(onUnauthorized);
  unauthorized.current = onUnauthorized;

  useEffect(() => {
    let active = true;
    setLoading(true); setError(null); setEmployees([]);
    void api.employees().then(response => { if (active) setEmployees(response.employees); }).catch(reason => {
      if (!active) return;
      if (reason instanceof ApiError && reason.status === 401) unauthorized.current();
      else setError(reason);
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, refresh]);

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visible = employees.filter(employee => `${employee.full_name} ${employee.employee_id} ${employee.role} ${employee.grade}`.toLocaleLowerCase().includes(normalizedQuery));
  return <>
    <PageHeading title={t('employees')} description={t('employeeDirectory')} action={<button className="button secondary" disabled={loading} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={16} />{t('refresh')}</button>} />
    {loading && <Loading />}
    <ErrorPanel error={error} retry={() => setRefresh(value => value + 1)} />
    {!loading && !error && <section className="panel">
      <label className="directory-search"><Search size={18} /><input type="search" aria-label={t('search')} placeholder={t('search')} value={query} onChange={event => setQuery(event.target.value)} /></label>
      {visible.length === 0 ? <Empty title={t(employees.length ? 'noResults' : 'noData')} icon={<Users size={24} />} /> : <div className="table-scroll"><table className="data-table">
        <thead><tr><th scope="col">{t('employee')}</th><th scope="col">{t('currentRole')}</th><th scope="col">{t('preview')}</th></tr></thead>
        <tbody>{visible.map(employee => <tr key={employee.employee_id}><td><strong>{employee.full_name}</strong><small>{employee.employee_id}</small></td><td>{employee.role}<small>{employee.grade}</small></td><td><button className="text-button" onClick={() => onOpen(employee.employee_id)} aria-label={`${t('openProfile')}: ${employee.full_name}`}>{t('openProfile')}<ArrowUpRight size={16} /></button></td></tr>)}</tbody>
      </table></div>}
    </section>}
    <p className="source-note">{t('originalContent')}</p>
  </>;
}
