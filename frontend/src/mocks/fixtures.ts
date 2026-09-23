import type { Language, ProfileResponse, Recommendation, RecommendationResponse } from '../api/types';

// Hand-authored response snapshots, not a second recommendation engine.
export const demoEmployee = { employee_id: 'DEMO_AIDANA', full_name: 'Айдана Серикова', role: 'Data Analyst', grade: 'Middle', department: 'Data & Analytics', preferred_language: 'ru' as const };
const snapshots = [
  { pct: 71.4, current: [3, 2, 2, 3, 3, 2], gap: [1, 2, 1, 0, 1, 1], critical: 0 },
  { pct: 81, current: [4, 3, 2, 3, 3, 2], gap: [0, 1, 1, 0, 1, 1], critical: 1 },
  { pct: 76.2, current: [3, 2, 3, 3, 3, 2], gap: [1, 2, 0, 0, 1, 1], critical: 1 },
  { pct: 85.7, current: [4, 3, 3, 3, 3, 2], gap: [0, 1, 0, 0, 1, 1], critical: 2 },
  { pct: 76.2, current: [3, 2, 2, 3, 3, 3], gap: [1, 2, 1, 0, 1, 0], critical: 0 },
  { pct: 85.7, current: [4, 3, 2, 3, 3, 3], gap: [0, 1, 1, 0, 1, 0], critical: 1 },
  { pct: 81, current: [3, 2, 3, 3, 3, 3], gap: [1, 2, 0, 0, 1, 0], critical: 1 },
  { pct: 90.5, current: [4, 3, 3, 3, 3, 3], gap: [0, 1, 0, 0, 1, 0], critical: 2 },
];
const skillDefs = [
  ['SK_SQL', 'SQL', 4, true], ['SK_BI_TOOLS', 'BI Tools', 4, false],
  ['SK_STATISTICS', 'Statistics', 3, true], ['SK_PYTHON', 'Python', 3, false],
  ['SK_DATA_VIZ', 'Data Visualization', 4, false], ['SK_PUBLIC_SPEAKING', 'Public Speaking', 3, false],
] as const;
export const eventBits: Record<string, number> = { EV_022: 1, EV_020: 2, EV_036: 4 };
export function demoProfile(mask: number, revision: number): ProfileResponse {
  const s = snapshots[mask];
  return {
    employee: demoEmployee, target: { role: 'Data Analyst', grade: 'Senior', source: 'career_goal' },
    readiness: { pct: s.pct, critical_met: s.critical, critical_total: 2 }, state_revision: revision,
    skills: skillDefs.map(([skill_id, name, required, critical], i) => ({ skill_id, name, required, critical, current: s.current[i], gap: s.gap[i] })),
    history: [
      { record_id: 'DEMO_H1', event_id: 'EV_012', title: 'Advanced Python', date: '2026-09-12', status: 'completed', completion_pct: 100, score: 87 },
      { record_id: 'DEMO_H2', event_id: 'EV_008', title: 'Business Writing & Documentation', date: '2026-09-18', status: 'completed', completion_pct: 100, score: null },
      { record_id: 'DEMO_H3', event_id: 'EV_024', title: 'Machine Learning for Analysts', date: '2026-09-25', status: 'in_progress', completion_pct: 40, score: null },
      ...Object.entries(eventBits).filter(([, bit]) => mask & bit).map(([event_id]) => ({
        record_id: 'DEMO_' + event_id, event_id, title: titles[event_id], date: '2026-10-01', status: 'completed', completion_pct: 100, score: null,
      })),
    ],
  };
}
const titles: Record<string, string> = { EV_022: 'SQL & BI for Analytics', EV_020: 'Applied Statistics for Analysts', EV_036: 'Public Speaking Club' };
const closings = [
  [{ skill_id: 'SK_SQL', name: 'SQL', from: 3, to: 4, required: 4, critical: true }, { skill_id: 'SK_BI_TOOLS', name: 'BI Tools', from: 2, to: 3, required: 4, critical: false }],
  [{ skill_id: 'SK_STATISTICS', name: 'Statistics', from: 2, to: 3, required: 3, critical: true }],
  [{ skill_id: 'SK_PUBLIC_SPEAKING', name: 'Public Speaking', from: 2, to: 3, required: 3, critical: false }],
];
export function demoRecommendations(mask: number, revision: number, language: Language): RecommendationResponse {
  const events = ['EV_022', 'EV_020', 'EV_036'].filter(id => !(mask & eventBits[id]));
  const recommendations: Recommendation[] = events.map(event_id => {
    const i = ['EV_022', 'EV_020', 'EV_036'].indexOf(event_id);
    const duration = [12, 40, 2][i];
    const name = closings[i][0].name;
    const reasons = {
      ru: ['Навык ' + name + ' входит в требования цели Senior.', 'Текущий уровень ' + closings[i][0].from + ', необходимый — ' + closings[i][0].required + '.', 'Активность занимает ' + duration + ' ч; формат: ' + ['онлайн', 'в своём темпе', 'очно'][i] + '.'],
      kk: [name + ' дағдысы Senior мақсатының талаптарына кіреді.', 'Қазіргі деңгей — ' + closings[i][0].from + ', қажетті деңгей — ' + closings[i][0].required + '.', 'Белсенділік ұзақтығы — ' + duration + ' сағ; формат: ' + ['онлайн', 'өз қарқыныңмен', 'офлайн'][i] + '.'],
      en: [name + ' is required for the Senior target.', 'Current level is ' + closings[i][0].from + '; required level is ' + closings[i][0].required + '.', 'This activity takes ' + duration + ' h; format: ' + ['online', 'self-paced', 'in person'][i] + '.'],
    };
    return {
      event_id, title: titles[event_id], type: ['course', 'course', 'meetup'][i], format: ['online', 'self_paced', 'offline'][i],
      duration_hours: duration, next_session: ['2026-10-20', null, '2026-10-08'][i],
      score: [0.34, 0.21, 0.12][i], impact: [0.67, 0.33, 0.2][i], likelihood: [0.51, 0.64, 0.6][i],
      closes: closings[i], unlocks: [], reasons: reasons[language],
      reason_factors: [
        { fact_id: event_id + '_target', type: 'target', values: { target_grade: 'Senior' } },
        { fact_id: event_id + '_gap', type: 'skill_gap', values: { skill_id: closings[i][0].skill_id, current: closings[i][0].from, required: closings[i][0].required } },
        { fact_id: event_id + '_duration', type: 'duration', values: { duration_hours: duration } },
      ],
    };
  });
  return { employee_id: demoEmployee.employee_id, language, state_revision: revision, source: 'fallback', fallback_reason: 'demo_fixture', leader_override: false, duration_ms: 0, recommendations, not_chosen: null, uncovered_critical: [], empty_reason: recommendations.length ? null : 'catalog_gap' };
}
