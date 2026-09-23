import { Check, CircleAlert } from 'lucide-react';
import type { Skill } from '../api/types';
import { useI18n } from '../i18n';
import { Empty } from './common';

export function SkillsTable({ skills }: { skills: Skill[] }) {
  const { t } = useI18n();
  if (!skills.length) return <Empty title={t('noData')}/>;
  return <div className="table-scroll"><table className="skills-table"><thead><tr><th>{t('skill')}</th><th>{t('level')}</th><th>{t('current')}</th><th>{t('required')}</th><th>{t('status')}</th></tr></thead><tbody>
    {skills.map(skill => <tr key={skill.skill_id}><td><span className="skill-name">{skill.name}{skill.critical && <CircleAlert size={14} className="critical-icon" aria-label={t('critical')}/>}</span><small className="skill-id">{skill.skill_id}</small></td><td><div className="skill-scale" aria-label={skill.current + ' / 5'}>{[1,2,3,4,5].map(n => <span key={n} className={(n <= skill.current ? 'filled ' : '') + (n === skill.required ? 'target-level' : '')}/>)}</div></td><td className="number">{skill.current}</td><td className="number">{skill.required ?? '—'}</td><td>{skill.required == null ? <span className="muted">{t('notRequired')}</span> : skill.gap === 0 ? <span className="badge success"><Check size={12}/>{t('covered')}</span> : <span className={'badge ' + (skill.critical ? 'warning' : 'neutral')}>{t(skill.critical ? 'critical' : 'developing')}</span>}</td></tr>)}
  </tbody></table></div>;
}
