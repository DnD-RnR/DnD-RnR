import { useState } from 'react';
import type { Combat, SpellZone } from './battle-types';
import type { useBattle } from './LiveBattle';
import { BindingZoneControls } from './BindingZoneControls';

type Controller = ReturnType<typeof useBattle>;
export function SpellZoneControls({ controller }: { controller: Controller }) {
  const b = controller.response!.battle!;
  if (!b.spellZones?.length) return null;
  return <section className="card"><h2>Aktywne strefy</h2>
    <p>MG ustala pozycje, odległości i widoczność zgodnie z opisem czaru.</p>
    {b.spellZones.map(zone => <Zone key={`${zone.id}:${b.round}:${zone.lastMovedRound}:${zone.needsPlacement}:${zone.moveReady}:${zone.memberIds.join(',')}`} zone={zone} battle={b} controller={controller} />)}
  </section>;
}

function Zone({ zone, battle: b, controller }: { zone: SpellZone; battle: Combat; controller: Controller }) {
  const [memberIds, setMemberIds] = useState(zone.memberIds), [targetIds, setTargetIds] = useState<string[]>([]);
  const current = b.fighters[b.turn], gm = controller.response!.gm;
  const motion = Boolean(zone.moveReady) || !zone.spec.stationary && !zone.spec.moveSlot && zone.sourceId === current.id && zone.lastMovedRound !== b.round;
  const canActivate = controller.response!.controlledIds.includes(zone.sourceId) && zone.sourceId === current.id && zone.spec.moveSlot && !zone.needsPlacement && !motion;
  const blocked = controller.pending || Boolean(b.pending) || b.fighters.some(f => f.concentrationDC);
  const toggle = (ids: string[], id: string) => ids.includes(id) ? ids.filter(v => v !== id) : [...ids, id];
  return <details open><summary>{zone.name} — {zone.sourceName}, {zone.spec.dice}k{zone.spec.sides} {zone.spec.type}, ST {zone.dc}</summary>
    <p>{zone.spec.gmNote}</p>
    <BindingZoneControls zone={zone} controller={controller} />
    {zone.spec.aura && <p>Wyłączone: {zone.excludedIds?.map(id => b.fighters.find(f => f.id === id)?.name).join(', ')}. Szybkość pozostałych wewnątrz jest dzielona przez dwa.</p>}
    {zone.spec.wall && <p>Wybrana gorąca strona: {({ front: 'przód', back: 'tył', inside: 'wnętrze', outside: 'zewnętrze' } as Record<string, string>)[zone.wallSide ?? '']}. W obszarze obrażeń końca tury są cele w ścianie lub do 10 stóp od tej strony. Chłodna strona nie zadaje obrażeń.</p>}
    <p>{zone.spec.separateCollision ? 'W odległości do 5 stóp od sfery' : 'W obszarze'}: {zone.memberIds.map(id => b.fighters.find(f => f.id === id)?.name).join(', ') || 'brak wskazanych celów'}.</p>
    {!!zone.shapeLockedIds?.length && <p>Moonbeam blokuje przemianę: {zone.shapeLockedIds.map(id => b.fighters.find(f => f.id === id)?.name).join(', ')}.</p>}
    {canActivate && <button disabled={blocked || Boolean(current[zone.spec.moveSlot!]) || zone.spec.moveSlot === 'action' && zone.createdRound === b.round} onClick={() => void controller.mutate('act', { kind: 'zone-activate', actorId: zone.sourceId, zoneId: zone.id })}>Przesuń do {zone.spec.moveDistance} stóp — {zone.spec.moveSlot === 'action' ? 'akcja Magic (późniejsza tura)' : 'akcja bonusowa'}</button>}
    {(zone.needsPlacement || motion) && <p role="status">{zone.needsPlacement ? 'MG musi odtworzyć położenie strefy po wznowieniu walki.' : zone.moveReady ? 'Działanie zużyte. MG potwierdza przesunięcie i wskazuje cele.' : 'Początek tury rzucającego: MG musi przesunąć chmurę o 10 stóp od niego i wskazać cele.'}</p>}
    {gm && <>
      {(zone.needsPlacement || motion || zone.spec.aura) && <form className="stack-form" onSubmit={e => { e.preventDefault(); void controller.mutate('act', { kind: zone.needsPlacement ? 'zone-place' : zone.spec.aura ? 'zone-update' : 'zone-move', zoneId: zone.id, memberIds, targetIds }); }}>
        <fieldset><legend>{zone.spec.separateCollision ? 'Cele w 5 stopach od sfery po przesunięciu' : 'Cele w obszarze po ustaleniu pozycji'}</legend>{b.fighters.map(f => <label key={f.id}><input type="checkbox" checked={memberIds.includes(f.id)} onChange={() => setMemberIds(toggle(memberIds, f.id))} />{f.name}</label>)}</fieldset>
        {!zone.spec.binding && !zone.spec.wall && !(zone.needsPlacement && zone.spec.separateCollision) && <fieldset><legend>{zone.spec.separateCollision ? 'Jeden cel zderzenia — sfera zatrzymuje się na nim' : 'Cele objęte ruchem strefy, również minięte po drodze'}</legend>{b.fighters.map(f => <label key={f.id}><input type="checkbox" checked={targetIds.includes(f.id)} onChange={() => setTargetIds(zone.spec.separateCollision ? targetIds.includes(f.id) ? [] : [f.id] : toggle(targetIds, f.id))} />{f.name}</label>)}</fieldset>}
        <button disabled={blocked}>Zatwierdź pozycje i rozlicz wskazane cele</button>
      </form>}
      {!zone.needsPlacement && !motion && <div className="stack-form">{b.fighters.map(f => <div key={f.id}>
        <span>{f.name}: </span><button disabled={blocked} onClick={() => void controller.mutate('act', { kind: zone.memberIds.includes(f.id) ? 'zone-leave' : 'zone-enter', zoneId: zone.id, targetId: f.id })}>{zone.spec.wall ? zone.memberIds.includes(f.id) ? 'Poza obszar obrażeń / chłodna strona' : 'W 10 stóp od gorącej strony' : zone.memberIds.includes(f.id) ? 'Opuszcza obszar' : 'Wchodzi w obszar / w 5 stóp od sfery'}</button>
        {zone.spec.wall && <button disabled={blocked} onClick={() => void controller.mutate('act', { kind: zone.wallIds?.includes(f.id) ? 'zone-wall-leave' : 'zone-wall-enter', zoneId: zone.id, targetId: f.id })}>{zone.wallIds?.includes(f.id) ? 'Opuszcza ścianę, pozostaje po gorącej stronie' : 'Wchodzi w samą ścianę'}</button>}
        {!zone.spec.noEndDamage && f.id === current.id && !zone.excludedIds?.includes(f.id) && zone.memberIds.includes(f.id) && zone.triggered[zone.spec.separateCollision ? `${f.id}:end` : f.id] !== `${b.round}:${current.id}` && <button disabled={blocked} onClick={() => void controller.mutate('act', { kind: 'zone-end-turn', zoneId: zone.id, targetId: f.id })}>Rozlicz koniec tury w strefie</button>}
      </div>)}</div>}
      <button disabled={blocked} onClick={() => void controller.mutate('act', { kind: 'zone-end', zoneId: zone.id })}>{zone.spec.moveSlot || zone.spec.stationary ? 'Zakończ strefę (rozstrzygnięcie MG)' : 'Zakończ strefę (np. rozproszenie silnym wiatrem)'}</button>
    </>}
  </details>;
}
