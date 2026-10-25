import type { StatisticsSummary } from '../../api';
import definitions from '../../../shared/statistics.json' with { type: 'json' };

const number = (value: number | null | undefined) => value ?? '—';
const signed = (value: number | null | undefined) => value == null ? '—' : value >= 0 ? `+${value}` : value;
const explorationSkills = ['athletics', 'acrobatics', 'stealth', 'perception', 'survival', 'investigation', 'nature', 'animalHandling'];

export function MemberStatistics({ stats }: { stats: StatisticsSummary }) {
  return <>
    <dl className="gm-vitals">
      <div><dt>Pasywna Percepcja</dt><dd>{number(stats.passivePerception)}</dd></div>
      <div><dt>Szybkość (stopy)</dt><dd>{number(stats.speed)}</dd></div>
    </dl>
    <dl className="gm-secondary gm-exploration">
      {explorationSkills.map(id => <div key={id}><dt>{definitions.skills.find(skill => skill.id === id)?.label}</dt><dd>{signed(stats.skills[id])}</dd></div>)}
      <div><dt>Wyczerpanie</dt><dd>{number(stats.exhaustion)}</dd></div>
    </dl>
  </>;
}
