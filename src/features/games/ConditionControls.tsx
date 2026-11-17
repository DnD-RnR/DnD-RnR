import { useState } from 'react';
import { conditionDefinitions, conditionsOf, conditionSpeedZero, hasCondition } from '../../../shared/conditions.mjs';
import type { Combatant } from './battle-types';
import type { useBattle } from './LiveBattle';

export function ConditionControls({ actor, controller }: { actor: Combatant; controller: ReturnType<typeof useBattle> }) {
  const b = controller.response!.battle!, active = conditionsOf(actor);
  const ownTurn = actor.id === b.fighters[b.turn].id && controller.response!.controlledIds.includes(actor.id);
  return <>
    {actor.flightNeedsReview && <p role="alert">Fly zakończony w powietrzu: MG rozstrzyga upadek lub jego zatrzymanie, wysokość i ewentualne obrażenia.</p>}
    <SourceConditions actor={actor} controller={controller} />
    {!!active.size && <details open><summary>Stany postaci</summary>{[...active].map(id => <p key={id}><strong>{conditionDefinitions[id]?.label ?? id}</strong>: {conditionDefinitions[id]?.description}</p>)}</details>}
    {ownTurn && hasCondition(actor, 'prone') && <button disabled={controller.pending || Boolean(b.pending) || conditionSpeedZero(actor) || actor.speed === 0} onClick={() => void controller.mutate('act', { kind: 'stand-up' })}>Wstań — koszt połowy szybkości</button>}
    {controller.response!.gm && <details><summary>MG: ręczne źródła stanów</summary><p>Usunięcie ręcznego źródła nie usuwa stanu z aktywnego czaru. Nakładanie i usuwanie stanów nie zużywa akcji postaci.</p>{Object.entries(conditionDefinitions).filter(([id]) => !['charmed', 'frightened', 'grappled', 'exhaustion'].includes(id)).map(([id, definition]) => <label className="battle-check" key={id}><input type="checkbox" checked={(actor.manualConditions ?? []).includes(id) || id === 'incapacitated' && actor.incapacitated === true || id === 'unconscious' && actor.unconscious === true || id === 'prone' && actor.prone === true} disabled={controller.pending || Boolean(b.pending)} onChange={e => void controller.mutate('act', { kind: 'condition', actorId: actor.id, condition: id, enabled: e.target.checked })} />{definition.label}</label>)}</details>}
  </>;
}

function SourceConditions({ actor, controller }: { actor: Combatant; controller: ReturnType<typeof useBattle> }) {
  const response = controller.response!, b = response.battle!;
  const [kind, setKind] = useState('charmed'), [sourceId, setSourceId] = useState('');
  const [visible, setVisible] = useState(true), [dc, setDC] = useState('10');
  const [roll, setRoll] = useState(''), [roll2, setRoll2] = useState(''), [skill, setSkill] = useState('athletics');
  const blocked = controller.pending || Boolean(b.pending);
  const own = response.controlledIds.includes(actor.id) && b.fighters[b.turn].id === actor.id;
  return <>
    {(actor.exhaustion ?? 0) > 0 && <p>Exhaustion: {actor.exhaustion}; kara do testów d20: −{2 * actor.exhaustion!}.</p>}
    {actor.conditionSources?.map(e => <div key={e.id}><p>{conditionDefinitions[e.kind]?.label}: {e.sourceName}{e.kind === 'frightened' ? e.visible === false ? ' (poza linią widzenia)' : ' (w linii widzenia)' : ''}{e.escapeDC ? `; ST ucieczki ${e.escapeDC}` : ''}</p>
      {response.gm && <button disabled={blocked} onClick={() => void controller.mutate('act', { kind: 'condition-source', actorId: actor.id, condition: e.kind, enabled: false, effectId: e.id })}>Usuń to źródło</button>}
      {own && e.kind === 'grappled' && <form className="stack-form" onSubmit={event => { event.preventDefault(); void controller.mutate('act', { kind: 'grapple-escape', actorId: actor.id, effectId: e.id, skill, roll: Number(roll), roll2: Number(roll2) }); }}>
        <label>Ucieczka akcją<select value={skill} onChange={event => setSkill(event.target.value)}><option value="athletics">Athletics</option><option value="acrobatics">Acrobatics</option></select></label>
        <label>k20<input required type="number" min={1} max={20} value={roll} onChange={event => setRoll(event.target.value)} /></label><label>Drugi k20 przy automatycznym ułatwieniu/utrudnieniu<input type="number" min={1} max={20} value={roll2} onChange={event => setRoll2(event.target.value)} /></label>
        <button disabled={blocked || Boolean(actor.action)}>Spróbuj uciec</button>
      </form>}
    </div>)}
    {response.gm && <details><summary>MG: źródła, wyczerpanie i widoczność</summary>
      <label><input type="checkbox" disabled={blocked} checked={actor.aloft ?? false} onChange={event => void controller.mutate('act', { kind: 'flight-state', actorId: actor.id, aloft: event.target.checked })} />W powietrzu (zmiana potwierdza rozliczenie lotu / upadku przez MG)</label>
      <label>Rozmiar bazowy (bez Enlarge/Reduce)<select disabled={blocked} defaultValue="" onChange={event => { if (event.target.value) void controller.mutate('act', { kind: 'base-size', actorId: actor.id, size: event.target.value }); }}><option value="">Ustal / popraw rozmiar</option>{['Tiny','Small','Medium','Large','Huge','Gargantuan'].map(size => <option key={size} value={size}>{size}</option>)}</select></label>
      <label>Exhaustion<select disabled={blocked} value={actor.exhaustion ?? 0} onChange={event => void controller.mutate('act', { kind: 'exhaustion', actorId: actor.id, level: Number(event.target.value) })}>{[0,1,2,3,4,5,6].map(n => <option key={n} value={n}>{n}{n === 6 ? ' — śmierć' : ''}</option>)}</select></label>
      <form className="stack-form" onSubmit={event => { event.preventDefault(); void controller.mutate('act', { kind: 'condition-source', actorId: actor.id, condition: kind, sourceId, visible, escapeDC: Number(dc), enabled: true }); }}>
        <label>Stan<select value={kind} onChange={event => setKind(event.target.value)}>{['charmed','frightened','grappled'].map(k => <option key={k} value={k}>{conditionDefinitions[k].label}</option>)}</select></label>
        <label>Sprawca<select required value={sourceId} onChange={event => setSourceId(event.target.value)}><option value="">Wybierz</option>{b.fighters.filter(f => f.id !== actor.id).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
        {kind === 'frightened' && <label><input type="checkbox" checked={visible} onChange={event => setVisible(event.target.checked)} />Źródło w linii widzenia</label>}
        {kind === 'grappled' && <label>ST ucieczki<input required type="number" min={1} max={100} value={dc} onChange={event => setDC(event.target.value)} /></label>}
        <button disabled={blocked}>Nałóż / zaktualizuj źródło</button>
      </form>
      <p>Wyjątki widoczności: {actor.name} widzi wskazane cele mimo Invisible / Blinded (MG potwierdza szczególne zmysły).</p>
      {b.fighters.filter(f => f.id !== actor.id).map(f => <label key={f.id}><input type="checkbox" disabled={blocked} checked={actor.seenInvisibleIds?.includes(f.id) ?? false} onChange={event => void controller.mutate('act', { kind: 'condition-sight', actorId: actor.id, targetId: f.id, visible: event.target.checked })} />{f.name}</label>)}
    </details>}
  </>;
}
