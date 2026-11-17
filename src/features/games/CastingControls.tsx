import { useState } from 'react';
import index from '../../../shared/spell-index.json';
import { TimedRollInputs } from './TimedEffectControls';
import { LuckInput } from './LuckInput';
import type { useBattle } from './LiveBattle';
type Controller = ReturnType<typeof useBattle>;

export function CastingControls({ controller }: { controller: Controller }) {
  const [roll, setRoll] = useState(''), [roll2, setRoll2] = useState(''), [luck, setLuck] = useState(''), [mind, setMind] = useState('');
  const [advantage, setAdvantage] = useState(false), [disadvantage, setDisadvantage] = useState(false), [timed, setTimed] = useState<Record<string, number>>({});
  const r = controller.response!, b = r.battle!, p = b.pending;
  if (p?.kind !== 'casting') return null;
  const caster = b.fighters.find(f => f.id === p.actorId)!;
  return <section className="card"><h2>Rzucanie czaru — {caster.name}: {p.spellName}</h2>
    {p.stage === 'window' ? <>
      <p>Czar jeszcze nie zadziałał. Komponenty: {p.components}. Uprawnione postacie mogą użyć Counterspell po potwierdzeniu zasięgu i widoczności przez MG.</p>
      {p.responders.filter(id => !p.passed.includes(id)).map(id => <div key={id}><p>Oczekiwanie: {b.fighters.find(f => f.id === id)?.name}</p>{r.controlledIds.includes(id) && <button disabled={controller.pending} onClick={() => void controller.mutate('act', { kind: 'casting-pass', actorId: id, castingId: p.id })}>Nie używam Counterspell — zachowaj reakcję</button>}{r.gm && !b.fighters.find(f => f.id === id)?.characterId && <MonsterSpellForm controller={controller} actorId={id} counter />}</div>)}
      {r.gm && <button disabled={controller.pending} onClick={() => void controller.mutate('act', { kind: 'casting-continue', castingId: p.id })}>MG: nikt więcej nie reaguje — kontynuuj</button>}
    </> : r.controlledIds.includes(caster.id) ? <form className="stack-form" onSubmit={e => { e.preventDefault(); void controller.mutate('act', { kind: 'counterspell-save', actorId: caster.id, castingId: p.id, roll: Number(roll), roll2: Number(roll2), advantage, disadvantage, ...timed, luckRoll: luck ? Number(luck) : undefined, mindSliverRoll: Number(mind) }); }}>
      <p>Rzut obronny CON, ST {p.counterDC}. Porażka przerywa czar i zużywa działanie, ale zachowuje miejsce na czar. To nie jest test koncentracji.</p>
      <TimedRollInputs actor={caster} values={timed} onChange={setTimed} /><LuckInput actor={caster} value={luck} onChange={setLuck} />
      <label>CON k20<input required type="number" min={1} max={20} value={roll} onChange={e => setRoll(e.target.value)} /></label>
      <label>Drugi k20 przy ułatwieniu/utrudnieniu<input type="number" min={1} max={20} value={roll2} onChange={e => setRoll2(e.target.value)} /></label>
      <label><input type="checkbox" checked={advantage} onChange={e => setAdvantage(e.target.checked)} />Ułatwienie</label><label><input type="checkbox" checked={disadvantage} onChange={e => setDisadvantage(e.target.checked)} />Utrudnienie</label>
      {caster.spellConditions?.some(e => e.kind === 'mind-sliver') && <label>Mind Sliver k4<input required type="number" min={1} max={4} value={mind} onChange={e => setMind(e.target.value)} /></label>}
      <button disabled={controller.pending}>Rozlicz CON przeciw Counterspell</button>
    </form> : <p>Oczekiwanie na CON rzucającego.</p>}
  </section>;
}

function MonsterSpellForm({ controller, actorId, counter = false }: { controller: Controller; actorId: string; counter?: boolean }) {
  const [spellId, setSpellId] = useState(counter ? 'counterspell' : 'fireball'), [level, setLevel] = useState('3'), [slot, setSlot] = useState('action');
  const [usesSlot, setUsesSlot] = useState(false), [confirmed, setConfirmed] = useState(false);
  const [withoutComponents, setWithoutComponents] = useState(false);
  const b = controller.response!.battle!;
  return <form className="stack-form" onSubmit={e => { e.preventDefault(); void controller.mutate('act', { kind: 'monster-cast', actorId, spellId, slot: counter ? 'reaction' : slot, level: Number(level), usesSlot, withoutComponents, confirmedResources: confirmed, confirmedCounterspell: counter && confirmed, castingId: b.pending?.kind === 'casting' ? b.pending.id : undefined }); }}>
    {!counter && <><label>Czar potwora<select value={spellId} onChange={e => { setSpellId(e.target.value); setLevel(String(index.spells.find(s => s.id === e.target.value)?.level ?? 0)); }}>{index.spells.filter(s => s.id !== 'counterspell').map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <label>Czas rzucania<select value={slot} onChange={e => setSlot(e.target.value)}><option value="action">Akcja</option><option value="bonus">Akcja bonusowa</option><option value="reaction">Reakcja — MG potwierdza wyzwalacz</option></select></label></>}
    <label>Krąg rzucenia<input required type="number" min={counter ? 3 : 0} max={9} value={level} onChange={e => setLevel(e.target.value)} /></label>
    <label><input type="checkbox" checked={usesSlot} onChange={e => setUsesSlot(e.target.checked)} />Potwór wydaje miejsce na czar (MG prowadzi jego pulę); bez zaznaczenia korzysta z użycia zdolności</label>
    <label><input type="checkbox" checked={withoutComponents} onChange={e => setWithoutComponents(e.target.checked)} />Opis zdolności potwora usuwa wszystkie komponenty — MG potwierdza; taki czar nie wyzwala Counterspell</label>
    <label><input required type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />MG potwierdza dostępność czaru i zasobów, komponenty, zasięg oraz widoczność{counter ? ' rzucającego w 60 stopach i komponent V, S lub M' : ''}.</label>
    <button disabled={controller.pending}>{counter ? 'Potwór rzuca Counterspell' : 'Zadeklaruj czar przed efektami'}</button>
  </form>;
}

export function MonsterCastingControls({ controller }: { controller: Controller }) {
  const [dc, setDC] = useState('14'), [actorId, setActorId] = useState('');
  const r = controller.response!, b = r.battle!, current = b.fighters[b.turn];
  if (!r.gm || b.pending) return null;
  const monsters = b.fighters.filter(f => !f.characterId);
  return <>{!current.characterId && <details><summary>Czar potwora — okno Counterspell</summary><MonsterSpellForm key={current.id} controller={controller} actorId={current.id} /></details>}
    {monsters.length > 0 && <details><summary>Counterspell potworów — dostępność ustala MG</summary><form className="stack-form" onSubmit={e => { e.preventDefault(); void controller.mutate('act', { kind: 'monster-counterspell-config', actorId, dc: Number(dc) }); }}>
      <label>Potwór<select required value={actorId} onChange={e => setActorId(e.target.value)}><option value="">Wybierz</option>{monsters.map(f => <option key={f.id} value={f.id}>{f.name}{f.counterspellDC ? ` — ST ${f.counterspellDC}` : ''}</option>)}</select></label>
      <label>ST Counterspell<input required type="number" min={1} max={40} value={dc} onChange={e => setDC(e.target.value)} /></label>
      <button disabled={controller.pending}>Włącz dostępność Counterspell</button><button type="button" disabled={controller.pending || !actorId} onClick={() => void controller.mutate('act', { kind: 'monster-counterspell-config', actorId, dc: null })}>Wyłącz dostępność</button>
    </form></details>}</>;
}
