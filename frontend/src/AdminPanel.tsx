import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';

type Employee = { employee_id: string; full_name: string; role: string; grade: string };
type Overview = {
  weak_skills: { skill_id: string; name: string; employees: number; critical_for: number }[];
  no_recommendation: {
    employee_id: string; role: string; grade: string; open_gaps: string[];
    blocked_by_prereq: { event_id?: string; title?: string }[];
  }[];
  participation: {
    event_id?: string; title: string; completed: number; total: number;
    no_show: number; declined: number; dropped: number;
  }[];
};
type ImportResult = {
  employee_ids: string[]; employees_upserted: number;
  history_imported: number; history_duplicates_skipped: number;
};
type Props = {
  request: <T = any>(path: string, options?: RequestInit) => Promise<T>;
  user: { role: string };
  onSelectEmployee: (id: string) => void;
};

export default function AdminPanel({ request, user, onSelectEmployee }: Props) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [importError, setImportError] = useState('');
  const [success, setSuccess] = useState('');
  const [importing, setImporting] = useState(false);
  const [employeeFile, setEmployeeFile] = useState<File | null>(null);
  const [historyFile, setHistoryFile] = useState<File | null>(null);
  const generation = useRef(0);
  const allowed = user.role === 'hr' || user.role === 'admin';

  const reload = useCallback(async () => {
    if (!allowed) return;
    const current = ++generation.current;
    setLoading(true);
    setError('');
    try {
      const [nextOverview, list] = await Promise.all([
        request<Overview>('/api/hr/overview'),
        request<{ employees: Employee[] }>('/api/employees'),
      ]);
      if (current !== generation.current) return;
      setOverview(nextOverview);
      setEmployees(list.employees);
    } catch (cause) {
      if (current === generation.current) {
        setError(cause instanceof Error ? cause.message : 'Не удалось загрузить обзор команды.');
      }
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [allowed, request]);

  useEffect(() => {
    void reload();
    return () => { generation.current += 1; };
  }, [reload]);

  const filteredEmployees = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return employees.filter(employee =>
      [employee.full_name, employee.employee_id, employee.role, employee.grade]
        .some(value => value.toLocaleLowerCase().includes(query)),
    );
  }, [employees, search]);

  async function importData(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (user.role !== 'admin' || importing) return;
    setImportError('');
    setSuccess('');
    if (!employeeFile || !historyFile) {
      setImportError('Выберите JSON с сотрудниками и CSV с историей участия.');
      return;
    }
    const body = new FormData();
    body.append('employees_file', employeeFile);
    body.append('history_file', historyFile);
    setImporting(true);
    try {
      const result = await request<ImportResult>('/api/admin/upload', { method: 'POST', body });
      setSuccess(`Импорт завершён: профилей — ${result.employees_upserted}, записей истории — ${result.history_imported}, повторов пропущено — ${result.history_duplicates_skipped}.`);
      await reload();
      if (result.employee_ids[0]) onSelectEmployee(result.employee_ids[0]);
    } catch (cause) {
      setImportError(cause instanceof Error ? cause.message : 'Не удалось импортировать файлы.');
    } finally {
      setImporting(false);
    }
  }

  if (!allowed) return <div className="alert error" role="alert">Обзор команды доступен HR и администратору.</div>;

  return (
    <div className="admin-panel">
      <div className="section-heading">
        <div><span className="eyebrow">КОМАНДА В ФОКУСЕ</span><h2>Пространство развития</h2><p className="muted">Навыки, следующие шаги и участие — в одном обзоре.</p></div>
        <button className="button secondary" onClick={() => void reload()} disabled={loading || importing}>{loading ? 'Обновляем…' : 'Обновить обзор'}</button>
      </div>

      {error && <div className="alert error" role="alert">{error}</div>}
      {loading && !overview && <div className="panel muted" role="status">Собираем актуальную картину команды…</div>}

      <div className="stats-grid">
        <article className="stat-card"><span className="muted">Сотрудники</span><strong>{overview ? employees.length : '—'}</strong><small>Профили в команде</small></article>
        <article className="stat-card"><span className="muted">Зоны развития</span><strong>{overview ? overview.weak_skills.length : '—'}</strong><small>Частые дефициты навыков</small></article>
        <article className="stat-card"><span className="muted">Нужен следующий шаг</span><strong>{overview ? overview.no_recommendation.length : '—'}</strong><small>Нет подходящей активности</small></article>
      </div>

      <section className="panel">
        <div className="section-heading"><div><h3>Люди и возможности</h3><p className="muted">Откройте профиль, чтобы увидеть личную траекторию.</p></div><span className="chip">{filteredEmployees.length} из {employees.length}</span></div>
        <label className="field"><span>Поиск по команде</span><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Имя, роль, грейд или ID сотрудника" /></label>
        <div className="table-wrap"><table><thead><tr><th>Сотрудник</th><th>Роль</th><th>Грейд</th><th><span className="muted">Профиль</span></th></tr></thead><tbody>
          {filteredEmployees.map(employee => <tr key={employee.employee_id}>
            <td><strong>{employee.full_name}</strong><div className="muted">{employee.employee_id}</div></td><td>{employee.role}</td><td><span className="chip">{employee.grade}</span></td>
            <td><button className="button secondary" onClick={() => onSelectEmployee(employee.employee_id)} aria-label={`Открыть профиль: ${employee.full_name}`}>Открыть ↗</button></td>
          </tr>)}
          {!filteredEmployees.length && !loading && <tr><td colSpan={4} className="muted">{search ? 'По вашему запросу никого не найдено.' : 'Профили пока не загружены.'}</td></tr>}
        </tbody></table></div>
      </section>

      {overview && <>
        <div className="content-grid">
          <section className="panel">
            <div className="section-heading"><div><span className="eyebrow">ПРИОРИТЕТЫ КОМАНДЫ</span><h3>Какие навыки усилить</h3></div></div>
            <p className="muted">Показаны навыки с дефицитом у 5 и более сотрудников.</p>
            {overview.weak_skills.map(skill => <div className="skill-row" key={skill.skill_id}>
              <div className="section-heading"><strong>{skill.name}</strong><span className="chip">{skill.employees} чел.</span></div>
              <progress value={skill.employees} max={Math.max(employees.length, skill.employees, 1)} aria-label={`${skill.name}: ${skill.employees} сотрудников`} />
              <p className="muted">Критично для следующего уровня: {skill.critical_for}</p>
            </div>)}
            {!overview.weak_skills.length && <p className="muted">Массовых дефицитов навыков не обнаружено.</p>}
          </section>
          <section className="panel">
            <div className="section-heading"><div><span className="eyebrow">ВНИМАНИЕ HR</span><h3>Помочь со следующим шагом</h3></div></div>
            {overview.no_recommendation.map(employee => <div className="skill-row" key={employee.employee_id}>
              <div className="section-heading"><strong>{employees.find(item => item.employee_id === employee.employee_id)?.full_name || employee.employee_id}</strong><button className="button secondary" onClick={() => onSelectEmployee(employee.employee_id)}>Профиль ↗</button></div>
              <p className="muted">{employee.role} · {employee.grade}</p>
              <p>{employee.blocked_by_prereq.length ? 'Для доступных активностей нужны предварительные навыки.' : 'В каталоге нет подходящего шага для открытых разрывов.'}</p>
              <div className="chips">{employee.open_gaps.map(id => <span className="chip" key={id}>{overview.weak_skills.find(skill => skill.skill_id === id)?.name || id}</span>)}</div>
              {employee.blocked_by_prereq.length > 0 && <p className="muted">Ожидают выполнения условий: {employee.blocked_by_prereq.map(item => item.title || item.event_id || 'Активность').join(', ')}</p>}
            </div>)}
            {!overview.no_recommendation.length && <p className="muted">Для сотрудников с открытыми разрывами есть доступные шаги.</p>}
          </section>
        </div>

        <section className="panel">
          <div className="section-heading"><div><h3>Участие в развитии</h3><p className="muted">Только добровольные активности. Знаменатель — все записи участия в активности, включая пропуски и отказы.</p></div></div>
          <div className="table-wrap"><table><thead><tr><th>Активность</th><th>Завершено / записей участия</th><th>Не пришли</th><th>Отказались</th><th>Прервали</th></tr></thead><tbody>
            {overview.participation.map((activity, index) => <tr key={activity.event_id || `${activity.title}-${index}`}><td>{activity.title}</td><td><strong>{activity.completed} / {activity.total}</strong><progress value={activity.completed} max={Math.max(activity.total, 1)} aria-label={`Завершено ${activity.completed} из ${activity.total} записей участия`} /></td><td>{activity.no_show}</td><td>{activity.declined}</td><td>{activity.dropped}</td></tr>)}
            {!overview.participation.length && <tr><td colSpan={5} className="muted">История участия пока пуста.</td></tr>}
          </tbody></table></div>
        </section>
      </>}

      {user.role === 'admin' && <section className="panel">
        <div className="section-heading"><div><span className="eyebrow">АДМИНИСТРАТОР</span><h3>Импорт профилей и истории</h3><p className="muted">Загрузите оба файла. После импорта откроется первый загруженный профиль.</p></div></div>
        {importError && <div className="alert error" role="alert">{importError}</div>}
        {success && <div className="alert success" role="status">{success}</div>}
        <form onSubmit={importData}>
          <div className="toolbar">
            <label className="field"><span>Профили сотрудников · JSON</span><input type="file" accept=".json,application/json" required disabled={importing} onChange={event => setEmployeeFile(event.target.files?.[0] || null)} /></label>
            <label className="field"><span>История участия · CSV</span><input type="file" accept=".csv,text/csv" required disabled={importing} onChange={event => setHistoryFile(event.target.files?.[0] || null)} /></label>
          </div>
          <button className="button primary" disabled={importing || !employeeFile || !historyFile} type="submit">{importing ? 'Импортируем…' : 'Загрузить и открыть профиль ↗'}</button>
        </form>
      </section>}
    </div>
  );
}
