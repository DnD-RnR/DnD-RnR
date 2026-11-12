import { LuckInput } from './LuckInput';
import { useState } from 'react';
import type { Combatant } from './battle-types';
import type { useBattle } from './LiveBattle';
import { CheckForm } from './BarbarianControls';
import { warlockDescriptions } from '../../../shared/warlock.mjs';

type Controller = ReturnType<typeof useBattle>;
function BondSave({ controller }: { controller: Controller }) {
  const [roll, setRoll] = useState(''), [roll2, setRoll2] = useState(''), [luck, setLuck] = useState('');
  const [advantage, setAdvantage] = useState(false), [disadvantage, setDisadvantage] = useState(false);
  const p = controller.response!.battle!.pending;
  if (p?.kind !== 'request' || !p.warlockBond) return null;
  const target = controller.response!.battle!.fighters.find(f => f.id === p.targetId);
  if (!target || !controller.response!.controlledIds.includes(target.id)) return <p>Clairvoyant Combatant: oczekiwanie na rzut WIS celu.</p>;
  return <form className="stack-form" onSubmit={e => { e.preventDefault(); void controller.mutate('act', { kind: 'clairvoyant-save', roll: Number(roll), roll2: Number(roll2), advantage, disadvantage, ...(luck ? { luckRoll: Number(luck) } : {}) }); }}>
    <p>{target.name}: Clairvoyant Combatant — rzut WIS</p>
    <label>k20<input required type="number" min={1} max={20} value={roll} onChange={e => setRoll(e.target.value)} /></label>
    <label><input type="checkbox" checked={advantage} onChange={e => setAdvantage(e.target.checked)} />Ułatwienie</label><label><input type="checkbox" checked={disadvantage} onChange={e => setDisadvantage(e.target.checked)} />Utrudnienie</label>
    {advantage !== disadvantage && <label>Drugi k20<input required type="number" min={1} max={20} value={roll2} onChange={e => setRoll2(e.target.value)} /></label>}
    <LuckInput actor={target} value={luck} onChange={setLuck} /><button disabled={controller.pending}>Rozstrzygnij WIS</button>
  </form>;
}
function WarlockFighter({ controller, f }: { controller: Controller; f: Combatant }) {
  const [targetId, setTargetId] = useState(''), [confirmed, setConfirmed] = useState(false), [combatant, setCombatant] = useState(false);
  const b = controller.response!.battle!, p = f.spellcasting!.warlock!;
  const ownTurn = b.fighters[b.turn].id === f.id;
  const disabled = controller.pending || Boolean(b.pending) || f.hp <= 0 || f.incapacitated || f.unconscious || b.fighters.some(t => t.concentrationDC || t.relentlessRagePending);
  return <section className="card"><h3>{f.name}: Warlock</h3>
    {p.luckMax > 0 && <p>Dark One’s Own Luck: {p.luckRemaining}/{p.luckMax}. Opcjonalny k10 jest dostępny w formularzach testów i rzutów obronnych.</p>}
    {p.thoughtShield && <p>{warlockDescriptions['Thought Shield']}</p>}
    {p.resilience && <p>Fiendish Resilience: {p.resistance ?? 'nie wybrano'}</p>}
    {p.awakenedMind && <p>Więź: {p.awakenedMind.targetName} · {p.telepathyMiles} mil · do {new Date(p.awakenedMind.expiresAt).toLocaleTimeString('pl-PL')}{p.awakenedMind.combat ? ' · Clairvoyant Combatant' : ''}</p>}
    {p.clairvoyantCombatant && <><p>Clairvoyant Combatant: {p.clairvoyantAvailable ? 'dostępne' : 'zużyte'}</p>{!p.clairvoyantAvailable && <button disabled={disabled || !f.spellcasting!.slots.some(s => s.source === 'pact' && s.remaining > 0)} onClick={() => void controller.mutate('act', { kind: 'clairvoyant-recover', actorId: f.id })}>Odnów za miejsce Pact Magic (bez akcji)</button>}</>}
    {(p.greatOldOne || f.hex) && <form className="stack-form" onSubmit={e => { e.preventDefault(); void controller.mutate('act', { kind: 'awakened-mind', actorId: f.id, targetId, confirmed, combatant }); }}>
      <label>Cel<select required value={targetId} onChange={e => setTargetId(e.target.value)}><option value="">Wybierz istotę</option>{b.fighters.filter(t => t.id !== f.id).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
      <label><input required type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />GM potwierdza widoczność i zasięg (Awakened Mind: 30 stóp; Hex: 90 stóp).</label>
      {p.clairvoyantCombatant && <label><input type="checkbox" checked={combatant} disabled={!p.clairvoyantAvailable} onChange={e => setCombatant(e.target.checked)} />Clairvoyant Combatant — wymuś rzut WIS</label>}
      {p.greatOldOne && <button disabled={disabled || !ownTurn || Boolean(f.bonus) || !targetId || !confirmed || combatant && !p.clairvoyantAvailable}>Awakened Mind (akcja dodatkowa)</button>}
      {f.hex && <button type="button" disabled={disabled || !ownTurn || Boolean(f.bonus) || !targetId || !confirmed} onClick={() => void controller.mutate('act', { kind: 'hex-transfer', actorId: f.id, targetId, confirmed })}>Przenieś Hex po pokonaniu celu</button>}
    </form>}
    <CheckForm f={f} controller={controller} />
  </section>;
}
function FiendBlessings({ controller }: { controller: Controller }) {
  const [confirmed, setConfirmed] = useState(false);
  const b = controller.response!.battle!;
  if (!controller.response!.gm) return null;
  const events = (b.fiendDefeats ?? []).filter(e => e.candidates.some(id => !e.granted.includes(id)));
  if (!events.length) return null;
  return <section className="card"><h3>Dark One’s Blessing — potwierdzenie GM</h3><label><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />Potwierdzam wroga i odległość do 10 stóp dla cudzego pokonania.</label>{events.map(e => <div key={e.id}><p>Pokonano: {e.targetName}</p>{e.candidates.filter(id => !e.granted.includes(id) && b.fighters.some(f => f.id === id)).map(id => <button key={id} disabled={controller.pending || !confirmed} onClick={() => void controller.mutate('act', { kind: 'dark-ones-blessing', actorId: id, eventId: e.id, enemy: confirmed, within10Feet: confirmed })}>Przyznaj tymczasowe PW: {b.fighters.find(f => f.id === id)?.name}</button>)}</div>)}</section>;
}
export function WarlockControls({ controller }: { controller: Controller }) {
  return <><FiendBlessings controller={controller} /><BondSave controller={controller} />{controller.response!.battle!.fighters.filter(f => f.spellcasting?.warlock?.enabled && controller.response!.controlledIds.includes(f.id)).map(f => <WarlockFighter key={f.id} controller={controller} f={f} />)}</>;
}
