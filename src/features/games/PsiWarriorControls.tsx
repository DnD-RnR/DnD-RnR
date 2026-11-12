import { useState } from 'react';
import type { useBattle } from './LiveBattle';
import { Card } from '../../components/ui/Card';
export function PsiWarriorControls({ controller }: { controller: ReturnType<typeof useBattle> }) {
  const [roll, setRoll] = useState('');
  const [targetId, setTargetId] = useState('');
  const [description, setDescription] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const r = controller.response, b = r?.battle;
  if (!b || !r) return null;
  const p = b.pending;
  const targets = p?.kind === 'damage' ? [p.targetId] : p?.kind === 'spell' && p.stage === 'effect' && ['attack', 'save'].includes(p.spec.mode) ? p.targets.map(t => t.id) : [];
  return <>{b.fighters.filter(f => f.psiMax && r.controlledIds.includes(f.id) && f.hp > 0 && !f.incapacitated && !f.unconscious).map(f => <Card key={f.id} title={`Psi Warrior: ${f.name}`}>
    <p>Psionic Energy: {f.psiUses}/{f.psiMax} k{f.psiSides}. Krótki odpoczynek: +1 kość. Długi: wszystkie.</p>
    {!f.reaction && !f.reactionDeferred && !!f.psiUses && (targets.length > 0 || p?.kind === 'waiting') && <form className="stack-form" onSubmit={e => { e.preventDefault(); void controller.mutate('act', { kind: 'protective-field', actorId: f.id, targetId, roll: Number(roll), psiConfirmed: confirmed }); }}>
      <p>Protective Field: reakcja, redukcja obrażeń o kość + INT (minimum 1).</p>
      <label>Chroniony cel<select required value={targetId} onChange={e => setTargetId(e.target.value)}><option value="">Wybierz</option>{b.fighters.filter(t => p?.kind === 'waiting' || targets.includes(t.id)).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
      <label>Wynik k{f.psiSides}<input required type="number" min={1} max={f.psiSides} value={roll} onChange={e => setRoll(e.target.value)} /></label>
      <label><input required type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />Widzę cel w 30 stopach; cel otrzymuje obrażenia.</label>
      <button className="primary-button" disabled={controller.pending}>Protective Field</button>
    </form>}
    {!p && b.fighters[b.turn].id === f.id && <>
      {!f.telekineticMovementAvailable && <button className="text-button" disabled={controller.pending || !f.psiUses} onClick={() => void controller.mutate('act', { kind: 'restore-telekinetic-movement', actorId: f.id })}>Odnów Telekinetic Movement (1 kość, bez akcji)</button>}
      {!f.action && f.telekineticMovementAvailable && <form className="stack-form" onSubmit={e => { e.preventDefault(); void controller.mutate('act', { kind: 'telekinetic-movement', actorId: f.id, description, psiConfirmed: confirmed }); }}>
        <p>Telekinetic Movement: akcja Magic, jedno użycie na krótki lub długi odpoczynek. Przenieś cel do 30 stóp. GM rozstrzyga położenie.</p>
        <label>Cel i miejsce docelowe<textarea required maxLength={1000} value={description} onChange={e => setDescription(e.target.value)} /></label>
        <label><input required type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />Widzę cel w 30 stopach i wolne miejsce docelowe. Cel to swobodny przedmiot do rozmiaru Large albo inna, chętna istota. Tiny przedmiot można przenieść do ręki lub z ręki.</label>
        <button className="primary-button" disabled={controller.pending}>Telekinetic Movement</button>
      </form>}
    </>}
  </Card>)}</>;
}
