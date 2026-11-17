import { useState } from 'react';
import { hasTimedModifier, weaponSizeModifier } from '../../../shared/timed-effects.mjs';
import type { Combatant } from './battle-types';
import type { useBattle } from './LiveBattle';
import { TimedRollInputs } from './TimedEffectControls';

export function HasteActionForm({ controller }: { controller: ReturnType<typeof useBattle> }) {
  const b = controller.response!.battle!, actor = b.fighters[b.turn];
  if (!controller.response!.controlledIds.includes(actor.id) || !hasTimedModifier(actor, 'haste')) return null;
  return <HasteForm controller={controller} actor={actor} />;
}
function HasteForm({ controller, actor }: { controller: ReturnType<typeof useBattle>; actor: Combatant }) {
  const [attackRange, setAttackRange] = useState(actor.characterId ? 'auto' : '');
  const [kind, setKind] = useState('dash'), [targetId, setTargetId] = useState(''), [attackId, setAttackId] = useState(actor.attacks[0]?.id ?? '');
  const [roll, setRoll] = useState(''), [roll2, setRoll2] = useState(''), [advantage, setAdvantage] = useState(false), [disadvantage, setDisadvantage] = useState(false), [within5Feet, setWithin5Feet] = useState(false);
  const [bonus, setBonus] = useState('0'), [dice, setDice] = useState('1'), [sides, setSides] = useState('6'), [damageBonus, setDamageBonus] = useState('0');
  const [sizeWeaponConfirmed, setSizeWeaponConfirmed] = useState(false);
  const [timed, setTimed] = useState<Record<string, number>>({});
  const b = controller.response!.battle!, slow = hasTimedModifier(actor, 'slow');
  return <details><summary>Dodatkowa akcja Haste{actor.hasteActionUsed ? ' — wykorzystana' : ''}</summary>
    <p>Jeden atak, Dash, Disengage, Hide albo Utilize. Bez Magic, Dodge i Help. Po końcu czaru: Incapacitated i szybkość 0 do końca następnej tury.</p>
    <form className="stack-form" onSubmit={e => { e.preventDefault(); void controller.mutate('act', { kind: ['hide', 'utilize'].includes(kind) ? 'request' : kind, hasteAction: kind, useHaste: true, slot: 'action', actorId: actor.id, targetId, attackId, roll: Number(roll), roll2: Number(roll2), advantage, disadvantage, within5Feet, attackRange, sizeWeaponConfirmed, ...timed, description: `Haste: ${kind} — MG rozstrzyga Hide / Utilize, bez akcji Magic.`, ...(!actor.characterId ? { attack: { id: 'haste-attack', name: 'Atak Haste', bonus: Number(bonus), dice: Number(dice), sides: Number(sides), damageBonus: Number(damageBonus) } } : {}) }); }}>
      <label>Działanie<select value={kind} onChange={e => setKind(e.target.value)}>{['attack','dash','disengage','hide','utilize','skip'].map(k => <option key={k} value={k}>{k}</option>)}</select></label>
      {kind === 'attack' && <><label>Typ ataku<select required value={attackRange} onChange={e => setAttackRange(e.target.value)}><option value="">MG: wybierz typ</option>{actor.characterId && <option value="auto">Według broni</option>}<option value="melee">Wręcz</option><option value="ranged">Dystansowy</option></select></label>{weaponSizeModifier(actor) !== 0 && <label><input type="checkbox" checked={sizeWeaponConfirmed} onChange={e => setSizeWeaponConfirmed(e.target.checked)} />MG potwierdza zmienioną broń / cios dla bestii lub potwora.</label>}
        {actor.characterId ? <label>Atak<select required value={attackId} onChange={e => setAttackId(e.target.value)}>{actor.attacks.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label> : <>
          <label>Premia ataku<input type="number" value={bonus} onChange={e => setBonus(e.target.value)} /></label><label>Liczba kości<input type="number" min={0} value={dice} onChange={e => setDice(e.target.value)} /></label><label>Rozmiar kości<input type="number" min={2} value={sides} onChange={e => setSides(e.target.value)} /></label><label>Premia obrażeń<input type="number" value={damageBonus} onChange={e => setDamageBonus(e.target.value)} /></label>
        </>}
        <label>Cel<select required value={targetId} onChange={e => setTargetId(e.target.value)}><option value="">Wybierz</option>{b.fighters.filter(f => f.id !== actor.id).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
        <TimedRollInputs actor={actor} values={timed} onChange={setTimed} />
        <label>k20<input required type="number" min={1} max={20} value={roll} onChange={e => setRoll(e.target.value)} /></label><label>Drugi k20 (gdy wymagany)<input type="number" min={1} max={20} value={roll2} onChange={e => setRoll2(e.target.value)} /></label>
        <label><input type="checkbox" checked={advantage} onChange={e => setAdvantage(e.target.checked)} />Ułatwienie</label><label><input type="checkbox" checked={disadvantage} onChange={e => setDisadvantage(e.target.checked)} />Utrudnienie</label><label><input type="checkbox" checked={within5Feet} onChange={e => setWithin5Feet(e.target.checked)} />MG potwierdza do 5 stóp (Prone / krytyk)</label>
      </>}
      <button disabled={controller.pending || Boolean(b.pending) || actor.hasteActionUsed || slow}>Użyj dodatkowej akcji</button>
    </form>
  </details>;
}
