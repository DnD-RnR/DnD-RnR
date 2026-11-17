import { useState } from 'react';
import type { useBattle } from './LiveBattle';
import type { RepeatSpell } from './battle-types';
import { TimedRollInputs } from './TimedEffectControls';
import { LuckInput } from './LuckInput';
type Controller = ReturnType<typeof useBattle>;

export function RepeatSpellControls({ controller }: { controller: Controller }) {
  const b = controller.response!.battle!;
  return <>{b.repeatSpells?.map(e => <Repeat key={`${e.id}:${e.needsConfirmation}:${e.contactIds.join(',')}`} effect={e} controller={controller} />)}</>;
}
function Repeat({ effect: e, controller }: { effect: RepeatSpell; controller: Controller }) {
  const response = controller.response!, b = response.battle!, source = b.fighters.find(f => f.id === e.sourceId)!;
  const [targetId, setTargetId] = useState(''), [ids, setIds] = useState<string[]>(e.contactIds), [confirmed, setConfirmed] = useState(false);
  const blocked = controller.pending || Boolean(b.pending) || b.fighters.some(f => f.concentrationDC);
  return <section className="card"><h2>{e.name} — {source.name}</h2><p>{e.spec.gmNote}</p>
    {e.objectName && <p>Przedmiot: {e.objectName}. W kontakcie: {e.contactIds.map(id => b.fighters.find(f => f.id === id)?.name).join(', ') || 'brak'}.</p>}
    {e.spellId === 'witch-bolt' && <p>Pierwotny cel: {e.targetName}.</p>}{e.needsConfirmation && <p>MG musi potwierdzić ciągłość celu Witch Bolt lub aktualne kontakty z tym samym przedmiotem Heat Metal po wznowieniu walki.</p>}
    {response.controlledIds.includes(source.id) && source.id === b.fighters[b.turn].id && <form className="stack-form" onSubmit={event => { event.preventDefault(); void controller.mutate('act', { kind: 'repeat-spell', actorId: source.id, effectId: e.id, targetId, confirmed }); }}>
      {e.spellId === 'spiritual-weapon' && <label>Cel ataku (opcjonalny)<select value={targetId} onChange={event => setTargetId(event.target.value)}><option value="">Tylko przesuń broń / bez ataku</option>{b.fighters.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>}
      <label><input required type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />MG potwierdza zasięg i warunki czaru; pozycje broni do 20 stóp i cel w 5 stopach dla Spiritual Weapon.</label>
      <button disabled={blocked || Boolean(source.bonus) || e.createdRound === b.round || e.needsConfirmation}>Ponów — akcja bonusowa, bez slotu</button>
    </form>}
    {response.gm && <>
      {(e.spellId === 'heat-metal' || e.needsConfirmation) && <form className="stack-form" onSubmit={event => { event.preventDefault(); void controller.mutate('act', { kind: 'repeat-contacts', effectId: e.id, targetIds: ids }); }}>
        <fieldset><legend>{e.spellId === 'witch-bolt' ? 'Ten sam pierwotny cel — potwierdź jego tożsamość i nieprzerwane warunki czaru' : 'Wszyscy w kontakcie z tym samym metalowym przedmiotem'}</legend>{b.fighters.map(f => <label key={f.id}><input type="checkbox" checked={ids.includes(f.id)} onChange={event => setIds(event.target.checked ? e.spellId === 'witch-bolt' ? [f.id] : [...ids, f.id] : ids.filter(id => id !== f.id))} />{f.name}</label>)}</fieldset>
        <button disabled={blocked}>Zatwierdź cele / kontakty</button>
      </form>}
      <button disabled={controller.pending} onClick={() => void controller.mutate('act', { kind: 'repeat-end', effectId: e.id })}>Zakończ efekt — MG (Witch Bolt: zasięg ponad 60 stóp lub pełna osłona)</button>
    </>}
  </section>;
}

export function HeatMetalSaveForm({ controller }: { controller: Controller }) {
  const [roll, setRoll] = useState(''), [roll2, setRoll2] = useState(''), [dropObject, setDropObject] = useState(false);
  const [advantage, setAdvantage] = useState(false), [disadvantage, setDisadvantage] = useState(false), [luck, setLuck] = useState(''), [mind, setMind] = useState('');
  const [timed, setTimed] = useState<Record<string, number>>({});
  const response = controller.response!, b = response.battle!, p = b.pending;
  if (p?.kind !== 'spell' || p.stage !== 'heat-save') return null;
  const target = p.heatSaves?.find(t => !t.resolved && response.controlledIds.includes(t.id)), fighter = b.fighters.find(f => f.id === target?.id);
  if (!target || !fighter) return <p>Heat Metal: oczekiwanie na CON celu trzymającego lub noszącego przedmiot.</p>;
  return <form className="stack-form" onSubmit={event => { event.preventDefault(); void controller.mutate('act', { kind: 'heat-save', targetId: target.id, roll: Number(roll), roll2: Number(roll2), advantage, disadvantage, dropObject, ...timed, luckRoll: luck ? Number(luck) : undefined, mindSliverRoll: Number(mind) }); }}>
    <p>{fighter.name}: obrażenia już rozliczone. CON ST {p.dc} nie zmniejsza obrażeń; decyduje o upuszczeniu przedmiotu.</p>
    <TimedRollInputs actor={fighter} values={timed} onChange={setTimed} /><LuckInput actor={fighter} value={luck} onChange={setLuck} />
    <label>k20<input required type="number" min={1} max={20} value={roll} onChange={e => setRoll(e.target.value)} /></label>
    <label>Drugi k20 przy ułatwieniu / utrudnieniu<input type="number" min={1} max={20} value={roll2} onChange={e => setRoll2(e.target.value)} /></label>
    <label><input type="checkbox" checked={advantage} onChange={e => setAdvantage(e.target.checked)} />Ułatwienie</label><label><input type="checkbox" checked={disadvantage} onChange={e => setDisadvantage(e.target.checked)} />Utrudnienie</label>
    {fighter.spellConditions?.some(e => e.kind === 'mind-sliver') && <label>Mind Sliver k4<input required type="number" min={1} max={4} value={mind} onChange={e => setMind(e.target.value)} /></label>}
    {target.canDrop ? <label><input type="checkbox" checked={dropObject} onChange={e => setDropObject(e.target.checked)} />Upuść także przy udanym CON (przy porażce obowiązkowo)</label> : <p>Przedmiotu nie można teraz upuścić, np. noszonego pancerza. Pozostanie utrudnienie ataków i testów.</p>}
    <button disabled={controller.pending}>Rozlicz CON i przedmiot</button>
  </form>;
}
