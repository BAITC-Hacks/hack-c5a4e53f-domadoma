import { useState } from 'react';
import { ArrowRight, CalendarDays, Check, Clock3, Code2, GraduationCap, Info, MapPin, Mic2, Sparkles } from 'lucide-react';
import type { Recommendation } from '../api/types';
import { dateLabel, enumLabel, useI18n } from '../i18n';
import { ConfirmDialog, Empty, ErrorPanel, Loading } from './common';
import type { EmployeeStore, EmployeeState } from '../state/employee';

export function Recommendations({ state, store, canComplete }: { state: EmployeeState; store: EmployeeStore; canComplete: boolean }) {
  const { t, lang } = useI18n();
  const [selected, setSelected] = useState<Recommendation | null>(null);
  const response = state.recommendations;
  return <section>
    {state.recommendationError != null && <ErrorPanel error={state.recommendationError} retry={() => { void store.refreshRecommendations(); }}/>}
    {state.recommendationsLoading && <Loading small/>}
    {response && <>
      <div className={'source-note ' + (response.source === 'fallback' ? 'fallback-note' : '')}><Info size={14}/><span>{t(response.source === 'fallback' ? 'fallback' : 'aiReasons')}</span></div>
      {response.recommendations.length === 0 ? <div className="panel"><Empty title={t('noRecommendations')} description={t(response.empty_reason ?? 'no_eligible_events')}/></div> : <div className="recommendation-grid">
        {response.recommendations.map((item, index) => {
          const Icon = item.type === 'meetup' ? Mic2 : index === 0 ? Code2 : GraduationCap;
          return <article key={item.event_id} className={'recommendation-card ' + (index === 0 ? 'featured' : '')}>
            <div className={'recommendation-art art-' + index}><span className="art-orbit orbit-one"/><span className="art-orbit orbit-two"/><span className="course-symbol"><Icon size={36} strokeWidth={1.5}/></span><span className="art-label">{t(index === 0 ? 'bestStep' : 'step')}{index > 0 && ' 0' + (index + 1)}</span>{index === 0 && <Sparkles size={15} className="art-sparkle"/>}</div>
            <div className="recommendation-body"><div className="course-meta"><span>{enumLabel(item.type, lang)}</span><span className="meta-dot"/><span><Clock3 size={12}/>{item.duration_hours} {t('hours')}</span></div><h3>{item.title}</h3><div className="course-schedule"><span><MapPin size={12}/>{enumLabel(item.format, lang)}</span><span><CalendarDays size={12}/>{item.next_session ? dateLabel(item.next_session, lang) : t('anytime')}</span></div>
              <div className="reason-block"><h4>{t('why')}</h4><ul>{item.reasons.map((reason, i) => <li key={i}><Check size={13}/><span>{reason}</span></li>)}</ul></div>
              <div className="closes"><h4>{t('gapClosure')}</h4>{item.closes.map(gap => <div key={gap.skill_id}><span>{gap.name}</span><strong>{gap.from}<ArrowRight size={12}/>{gap.to}</strong></div>)}</div>
              {item.prerequisites && Object.keys(item.prerequisites).length > 0 && <p className="fine-print">{t('prerequisites')}: {Object.entries(item.prerequisites).map(([key, value]) => key + ' ≥ ' + value).join(', ')}</p>}
              {item.unlocks.length > 0 && <p className="fine-print">{t('unlocks')}: {item.unlocks.map(v => typeof v === 'string' ? v : JSON.stringify(v)).join(', ')}</p>}
              {canComplete && <button className={'button full ' + (index === 0 ? 'primary' : 'secondary')} disabled={!!state.completing || (item.event_id === 'EV_036' && !item.next_session)} onClick={() => setSelected(item)}>{state.completing === item.event_id ? t('saving') : t('markComplete')}<ArrowRight size={15}/></button>}
            </div>
          </article>;
        })}
      </div>}
      {response.not_chosen && <p className="source-note"><Info size={15}/>{response.not_chosen.text}</p>}
      {response.uncovered_critical.length > 0 && <p className="source-note">{t('criticalSkills')}: {response.uncovered_critical.join(', ')}</p>}
      <p className="fine-print content-origin">{t('originalContent')} {t('actualResult')}</p>
    </>}
    {selected && <ConfirmDialog title={t('confirmTitle')} busy={!!state.completing} onClose={() => setSelected(null)} onConfirm={() => { void store.complete(selected).then(() => { if (!store.snapshot().error) setSelected(null); }); }}>
      <p className="selected-course">{selected.title}</p><p>{t('confirmDescription')}</p><ErrorPanel error={state.error}/>
    </ConfirmDialog>}
  </section>;
}
