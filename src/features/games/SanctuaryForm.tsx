import { useState } from 'react';
import type { useBattle } from './LiveBattle';
import { TimedRollInputs } from './TimedEffectControls';
import { LuckInput } from './LuckInput';

export function SanctuaryForm({ controller }: { controller: ReturnType<typeof useBattle> }) {
  const [roll, setRoll] = useState(''), [roll2, setRoll2] = useState(''), [targetId, setTargetId] = useState('');
  const [advantage, setAdvantage] = useState(false), [disadvantage, setDisadvantage] = useState(false), [luck, setLuck] = useState(''), [mind, setMind] = useState('');
  const [attackRoll, setAttackRoll] = useState(''), [attackRoll2, setAttackRoll2] = useState(''), [timed, setTimed] = useState<Record<string, number>>({});
  const r = controller.response!, b = r.battle!, p = b.pending;
  if (p?.kind !== 'sanctuary') return null;
  const actor = b.fighters.find(f => f.id === p.actorId)!;
  if (!r.controlledIds.includes(actor.id)) return <p>Sanctuary: oczekiwanie na WIS lub nowy cel wybrany przez atakującego.</p>;
  return <section className="card"><h2>Sanctuary — {actor.name}</h2><p>Cel chroniony: {b.fighters.find(f => f.id === p.targetId)?.name}.</p>
    <form className="stack-form" onSubmit={e => { e.preventDefault(); void controller.mutate('act', p.stage === 'save' ? { kind: 'sanctuary-save', roll: Number(roll), roll2: Number(roll2), advantage, disadvantage, ...timed, luckRoll: luck ? Number(luck) : undefined, mindSliverRoll: Number(mind), attackRoll: Number(attackRoll), attackRoll2: Number(attackRoll2) } : { kind: 'sanctuary-choice', targetId, attackRoll: Number(attackRoll), attackRoll2: Number(attackRoll2) }); }}>
      {p.stage === 'save' ? <>
        <p>WIS, ST {p.dc}. Przy porażce wybierzesz inny cel albo stracisz atak/czar.</p>
        <TimedRollInputs actor={actor} values={timed} onChange={setTimed} /><LuckInput actor={actor} value={luck} onChange={setLuck} />
        <label>WIS k20<input required type="number" min={1} max={20} value={roll} onChange={e => setRoll(e.target.value)} /></label><label>Drugi k20 przy ułatwieniu/utrudnieniu<input type="number" min={1} max={20} value={roll2} onChange={e => setRoll2(e.target.value)} /></label>
        <label><input type="checkbox" checked={advantage} onChange={e => setAdvantage(e.target.checked)} />Ułatwienie</label><label><input type="checkbox" checked={disadvantage} onChange={e => setDisadvantage(e.target.checked)} />Utrudnienie</label>
        {actor.spellConditions?.some(e => e.kind === 'mind-sliver') && <label>Mind Sliver k4<input required type="number" min={1} max={4} value={mind} onChange={e => setMind(e.target.value)} /></label>}
      </> : <label>Nowy cel albo utrata ataku/czaru<select value={targetId} onChange={e => setTargetId(e.target.value)}><option value="">Strać ten atak / czar</option>{b.fighters.filter(f => !p.visited.includes(f.id)).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>}
      <label>Opcjonalnie wynik k20 samego ataku (nie WIS)<input type="number" min={1} max={20} value={attackRoll} onChange={e => setAttackRoll(e.target.value)} /></label><label>Drugi k20 ataku, jeśli nowy cel wymaga ułatwienia/utrudnienia<input type="number" min={1} max={20} value={attackRoll2} onChange={e => setAttackRoll2(e.target.value)} /></label>
      <button disabled={controller.pending}>{p.stage === 'save' ? 'Rozlicz WIS' : 'Zatwierdź wybór'}</button>
    </form>
  </section>;
}
