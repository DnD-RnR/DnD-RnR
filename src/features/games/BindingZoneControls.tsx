import { useState } from 'react';
import type { SpellZone } from './battle-types';
import type { useBattle } from './LiveBattle';

export function BindingZoneControls({ zone, controller }: { zone: SpellZone; controller: ReturnType<typeof useBattle> }) {
  const [roll, setRoll] = useState(''), [roll2, setRoll2] = useState(''), [advantage, setAdvantage] = useState(false), [disadvantage, setDisadvantage] = useState(false);
  const [label, setLabel] = useState(''), [members, setMembers] = useState<string[]>([]), [note, setNote] = useState('');
  const r = controller.response!, b = r.battle!, current = b.fighters[b.turn], token = `${b.round}:${current.id}`;
  if (!zone.spec.binding) return null;
  const blocked = controller.pending || Boolean(b.pending), owned = r.controlledIds.includes(current.id);
  return <>
    <p>Restrained: {zone.restrainedIds?.map(id => b.fighters.find(f => f.id === id)?.name).join(', ') || 'brak'}. ST Athletics: {zone.dc}.</p>
    {!zone.needsPlacement && (r.gm || owned) && zone.spec.binding === 'web' && <>
      {zone.startMemberIds?.includes(current.id) && zone.memberIds.includes(current.id) && zone.triggered[`${current.id}:start`] !== token && <button disabled={blocked} onClick={() => void controller.mutate('act', { kind: 'zone-start', zoneId: zone.id })}>Początek tury: DEX w Web</button>}
      {zone.startFireEligible && zone.fireTriggered !== token && <button disabled={blocked} onClick={() => void controller.mutate('act', { kind: 'zone-start', zoneId: zone.id, fire: true })}>Początek tury: 2k4 Fire płonących sieci</button>}
    </>}
    {owned && zone.restrainedIds?.includes(current.id) && <form className="stack-form" onSubmit={e => { e.preventDefault(); void controller.mutate('act', { kind: 'zone-escape', zoneId: zone.id, roll: Number(roll), roll2: Number(roll2), advantage, disadvantage }); }}>
      <label>Uwolnienie — STR (Athletics), k20<input required type="number" min={1} max={20} value={roll} onChange={e => setRoll(e.target.value)} /></label><label>Drugi k20 przy ułatwieniu/utrudnieniu<input type="number" min={1} max={20} value={roll2} onChange={e => setRoll2(e.target.value)} /></label>
      <label><input type="checkbox" checked={advantage} onChange={e => setAdvantage(e.target.checked)} />Ułatwienie</label><label><input type="checkbox" checked={disadvantage} onChange={e => setDisadvantage(e.target.checked)} />Utrudnienie</label><button disabled={blocked || Boolean(current.action)}>Wydaj akcję i spróbuj się uwolnić</button>
    </form>}
    {r.gm && <>
      <label>Powód ręcznego uwolnienia / zniszczenia więzów<input maxLength={200} value={note} onChange={e => setNote(e.target.value)} /></label>{zone.restrainedIds?.map(id => <button key={id} disabled={blocked || !note.trim()} onClick={() => void controller.mutate('act', { kind: 'zone-free', zoneId: zone.id, targetId: id, note })}>MG uwalnia {b.fighters.find(f => f.id === id)?.name}</button>)}
      {zone.spec.binding === 'web' && <>
        <p>Po wypaleniu fragmentu MG odtwarza obsadę pozostałych sieci; nie wskazuje ponownie początkowych celów.</p>
        <label>Fragment 5-stopowego sześcianu<input maxLength={80} value={label} onChange={e => setLabel(e.target.value)} /></label>
        <fieldset><legend>Stworzenia w tym fragmencie</legend>{b.fighters.filter(f => zone.memberIds.includes(f.id)).map(f => <label key={f.id}><input type="checkbox" checked={members.includes(f.id)} onChange={e => setMembers(e.target.checked ? [...members, f.id] : members.filter(id => id !== f.id))} />{f.name}</label>)}</fieldset>
        <button disabled={blocked || !label.trim()} onClick={() => void controller.mutate('act', { kind: 'zone-fire', zoneId: zone.id, label, memberIds: members })}>MG potwierdza podpalenie fragmentu</button>
        {zone.fires?.map(f => <p key={f.id}>{f.label}: {f.expired ? 'wypalony — odtwórz pozycje pozostałej pajęczyny' : `płonie do rundy ${f.endRound}`}{!f.expired && <button disabled={blocked} onClick={() => void controller.mutate('act', { kind: 'zone-fire-members', zoneId: zone.id, fireId: f.id, memberIds: members })}>Ustaw zaznaczoną obsadę tego ognia</button>}</p>)}
      </>}
    </>}
  </>;
}
