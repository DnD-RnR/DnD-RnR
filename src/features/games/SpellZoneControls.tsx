import { useState } from 'react';
import type { Combat, SpellZone } from './battle-types';
import type { useBattle } from './LiveBattle';

type Controller = ReturnType<typeof useBattle>;
export function SpellZoneControls({ controller }: { controller: Controller }) {
  const b = controller.response!.battle!;
  if (!b.spellZones?.length) return null;
  return <section className="card"><h2>Aktywne chmury</h2>
    <p>MG ustala pozycje i widoczność w silnie przesłoniętym obszarze. Każdy cel wykonuje rzut dla danej chmury najwyżej raz na turę dowolnego uczestnika.</p>
    {b.spellZones.map(zone => <Zone key={`${zone.id}:${b.round}:${zone.lastMovedRound}:${zone.needsPlacement}`} zone={zone} battle={b} controller={controller} />)}
  </section>;
}

function Zone({ zone, battle: b, controller }: { zone: SpellZone; battle: Combat; controller: Controller }) {
  const [memberIds, setMemberIds] = useState(zone.memberIds), [targetIds, setTargetIds] = useState<string[]>([]);
  const current = b.fighters[b.turn], gm = controller.response!.gm;
  const motion = zone.sourceId === current.id && zone.lastMovedRound !== b.round;
  const blocked = controller.pending || Boolean(b.pending) || b.fighters.some(f => f.concentrationDC);
  const toggle = (ids: string[], id: string) => ids.includes(id) ? ids.filter(v => v !== id) : [...ids, id];
  return <details open><summary>{zone.name} — {zone.sourceName}, {zone.spec.dice}k{zone.spec.sides} {zone.spec.type}, ST {zone.dc}</summary>
    <p>{zone.spec.gmNote}</p>
    <p>W chmurze: {zone.memberIds.map(id => b.fighters.find(f => f.id === id)?.name).join(', ') || 'brak wskazanych celów'}.</p>
    {(zone.needsPlacement || motion) && <p role="status">{zone.needsPlacement ? 'MG musi odtworzyć położenie chmury po wznowieniu walki.' : 'Początek tury rzucającego: MG musi przesunąć chmurę o 10 stóp od niego i wskazać cele, zanim tura będzie kontynuowana.'}</p>}
    {gm && <>
      {(zone.needsPlacement || motion) && <form className="stack-form" onSubmit={e => { e.preventDefault(); void controller.mutate('act', { kind: zone.needsPlacement ? 'zone-place' : 'zone-move', zoneId: zone.id, memberIds, targetIds }); }}>
        <fieldset><legend>Cele znajdujące się w chmurze po ustaleniu pozycji</legend>{b.fighters.map(f => <label key={f.id}><input type="checkbox" checked={memberIds.includes(f.id)} onChange={() => setMemberIds(toggle(memberIds, f.id))} />{f.name}</label>)}</fieldset>
        <fieldset><legend>Cele, w których przestrzeń wchodzi chmura (również minięte po drodze)</legend>{b.fighters.map(f => <label key={f.id}><input type="checkbox" checked={targetIds.includes(f.id)} onChange={() => setTargetIds(toggle(targetIds, f.id))} />{f.name}</label>)}</fieldset>
        <button disabled={blocked}>Zatwierdź pozycje i rozlicz wskazane cele</button>
      </form>}
      {!zone.needsPlacement && !motion && <div className="stack-form">{b.fighters.map(f => <div key={f.id}>
        <span>{f.name}: </span><button disabled={blocked} onClick={() => void controller.mutate('act', { kind: zone.memberIds.includes(f.id) ? 'zone-leave' : 'zone-enter', zoneId: zone.id, targetId: f.id })}>{zone.memberIds.includes(f.id) ? 'Opuszcza chmurę' : 'Wchodzi w chmurę'}</button>
        {f.id === current.id && zone.memberIds.includes(f.id) && zone.triggered[f.id] !== `${b.round}:${current.id}` && <button disabled={blocked} onClick={() => void controller.mutate('act', { kind: 'zone-end-turn', zoneId: zone.id, targetId: f.id })}>Rozlicz koniec tury w chmurze</button>}
      </div>)}</div>}
      <button disabled={blocked} onClick={() => void controller.mutate('act', { kind: 'zone-end', zoneId: zone.id })}>Zakończ strefę (np. rozproszenie silnym wiatrem)</button>
    </>}
  </details>;
}
