import { useState } from 'react';
import { LuckInput } from './LuckInput';
import type { useBattle } from './LiveBattle';

export function DispelMagicForm({ controller }: { controller: ReturnType<typeof useBattle> }) {
  const [roll, setRoll] = useState(''), [roll2, setRoll2] = useState(''), [luck, setLuck] = useState('');
  const [advantage, setAdvantage] = useState(false), [disadvantage, setDisadvantage] = useState(false);
  const r = controller.response!, b = r.battle!, p = b.pending;
  if (p?.kind !== 'dispel') return null;
  const caster = b.fighters.find(f => f.id === p.actorId)!;
  const effect = p.effects[0];
  if (!r.controlledIds.includes(caster.id)) return <p>Dispel Magic: oczekiwanie na test rzucającego.</p>;
  return <form className="card stack-form" onSubmit={e => { e.preventDefault(); void controller.mutate('act', { kind: 'dispel-check', actorId: caster.id, roll: Number(roll), roll2: Number(roll2), advantage, disadvantage, luckRoll: Number(luck) }); }}>
    <h2>Dispel Magic — {effect.name}</h2>
    <p>Test cechy czarowania {p.ability >= 0 ? '+' : ''}{p.ability}, ST {10 + effect.level}. Każdy wyższy czar wymaga osobnego testu. Bless, Bane i Mind Sliver nie modyfikują testu cechy.</p>
    <label>k20<input required type="number" min={1} max={20} value={roll} onChange={e => setRoll(e.target.value)} /></label>
    <label>Drugi k20 przy ułatwieniu/utrudnieniu<input type="number" min={1} max={20} value={roll2} onChange={e => setRoll2(e.target.value)} /></label>
    <label><input type="checkbox" checked={advantage} onChange={e => setAdvantage(e.target.checked)} />Ułatwienie</label>
    <label><input type="checkbox" checked={disadvantage} onChange={e => setDisadvantage(e.target.checked)} />Utrudnienie (Poisoned i Hex uwzględnia serwer)</label>
    <LuckInput actor={caster} value={luck} onChange={setLuck} />
    <button disabled={controller.pending}>Rozstrzygnij test</button>
  </form>;
}
