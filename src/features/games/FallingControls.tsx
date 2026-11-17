import { useState } from 'react';
import { hasTimedModifier } from '../../../shared/timed-effects.mjs';
import { LuckInput } from './LuckInput';
import type { Combatant } from './battle-types';
import type { useBattle } from './LiveBattle';
type Controller = ReturnType<typeof useBattle>;

export function FallingControls({ controller }: { controller: Controller }) {
  const [ids, setIds] = useState<string[]>([]), [liquid, setLiquid] = useState(false);
  const r = controller.response!, b = r.battle!;
  if (b.pending) return null;
  return <>
    {r.gm && <details><summary>Ogłoś spadanie — przed lądowaniem</summary><form className="stack-form" onSubmit={async e => { e.preventDefault(); if (await controller.mutate('act', { kind: 'fall-start', targetIds: ids, liquid })) setIds([]); }}>
      <p>MG ustala pozycje i wysokość. Ogłoszenie spadania daje czas na Feather Fall; obrażenia rozlicz przy lądowaniu.</p>
      {b.fighters.filter(f => !f.falling).map(f => <label key={f.id}><input type="checkbox" checked={ids.includes(f.id)} onChange={e => setIds(e.target.checked ? [...ids, f.id] : ids.filter(id => id !== f.id))} />{f.name}</label>)}
      <label><input type="checkbox" checked={liquid} onChange={e => setLiquid(e.target.checked)} />Upadek do wody lub innej cieczy — możliwy test z reakcją</label>
      <button disabled={controller.pending || !ids.length}>Ogłoś spadanie</button>
    </form></details>}
    {b.fighters.filter(f => f.falling).map(f => <section className="card" key={f.id}><h2>Spadanie — {f.name}</h2>
      {hasTimedModifier(f, 'fallProtection') && <p>Feather Fall: opadanie 60 stóp na rundę. Lądowanie przed końcem czaru: bez obrażeń, koniec ochrony dla tego celu.</p>}
      {f.fallWaterSuccess && <p>Udany test wejścia do cieczy: połowa obrażeń upadku.</p>}
      {r.controlledIds.includes(f.id) && f.fallLiquid && !f.fallWaterTried && !f.reaction && <WaterEntryForm controller={controller} actor={f} />}
      {r.gm && <><LandingForm key={`${f.id}:${hasTimedModifier(f, 'fallProtection')}`} controller={controller} actor={f} />
        <button disabled={controller.pending} onClick={() => void controller.mutate('act', { kind: 'fall-stop', actorId: f.id })}>MG: spadanie zatrzymane przed lądowaniem</button></>}
    </section>)}
  </>;
}

function LandingForm({ controller, actor }: { controller: Controller; actor: Combatant }) {
  const [feet, setFeet] = useState('10'), [rolls, setRolls] = useState<string[]>([]);
  const [immune, setImmune] = useState(false), [vulnerable, setVulnerable] = useState(false), [proneImmune, setProneImmune] = useState(false);
  const [resistant, setResistant] = useState(false);
  const count = hasTimedModifier(actor, 'fallProtection') ? 0 : Math.min(20, Math.max(0, Math.floor(Number(feet) / 10)));
  return <form className="stack-form" onSubmit={e => { e.preventDefault(); void controller.mutate('act', { kind: 'fall-land', actorId: actor.id, feet: Number(feet), rolls: Array.from({ length: count }, (_, i) => Number(rolls[i])), immune, resistant, vulnerable, proneImmune }); }}>
    <label>Wysokość upadku w stopach — ustala MG<input required type="number" min={0} max={1000000} step={1} value={feet} onChange={e => { setFeet(e.target.value); setRolls([]); }} /></label>
    <p>{count}k6 obrażeń obuchowych, maksymalnie 20k6. Zapisane odporności silnik uwzględni automatycznie.</p>
    {Array.from({ length: count }, (_, i) => <label key={i}>k6 nr {i + 1}<input required type="number" min={1} max={6} value={rolls[i] ?? ''} onChange={e => setRolls(Array.from({ length: count }, (_, n) => n === i ? e.target.value : rolls[n] ?? ''))} /></label>)}
    <label><input type="checkbox" checked={immune} onChange={e => setImmune(e.target.checked)} />MG potwierdza niewrażliwość na te obrażenia</label>
    <label><input type="checkbox" checked={resistant} onChange={e => setResistant(e.target.checked)} />MG potwierdza dodatkowe źródło odporności na te obrażenia (odporności nie sumują się)</label>
    <label><input type="checkbox" checked={vulnerable} onChange={e => setVulnerable(e.target.checked)} />MG potwierdza podatność na te obrażenia</label>
    <label><input type="checkbox" checked={proneImmune} onChange={e => setProneImmune(e.target.checked)} />MG potwierdza niewrażliwość na Prone</label>
    <button disabled={controller.pending}>Rozlicz lądowanie</button>
  </form>;
}

function WaterEntryForm({ controller, actor }: { controller: Controller; actor: Combatant }) {
  const [skill, setSkill] = useState('athletics'), [roll, setRoll] = useState(''), [roll2, setRoll2] = useState(''), [total, setTotal] = useState(''), [luck, setLuck] = useState('');
  const [advantage, setAdvantage] = useState(false), [disadvantage, setDisadvantage] = useState(false);
  return <form className="stack-form" onSubmit={e => { e.preventDefault(); void controller.mutate('act', { kind: 'fall-water', actorId: actor.id, skill, roll: Number(roll), roll2: Number(roll2), total: Number(total), advantage, disadvantage, luckRoll: luck ? Number(luck) : undefined }); }}>
    <p>Wejście do cieczy: reakcja i test ST 15. Sukces zmniejsza obrażenia upadku o połowę; reakcja jest zużywana także przy porażce.</p>
    <label>Test<select value={skill} onChange={e => setSkill(e.target.value)}><option value="athletics">STR (Athletics)</option><option value="acrobatics">DEX (Acrobatics)</option></select></label>
    {actor.characterId ? <>
      <label>k20<input required type="number" min={1} max={20} value={roll} onChange={e => setRoll(e.target.value)} /></label>
      <label>Drugi k20 przy ułatwieniu/utrudnieniu<input type="number" min={1} max={20} value={roll2} onChange={e => setRoll2(e.target.value)} /></label>
      <label><input type="checkbox" checked={advantage} onChange={e => setAdvantage(e.target.checked)} />Ułatwienie</label><label><input type="checkbox" checked={disadvantage} onChange={e => setDisadvantage(e.target.checked)} />Utrudnienie</label>
      <LuckInput actor={actor} value={luck} onChange={setLuck} />
    </> : <label>Pełny wynik testu potwora — oblicza MG<input required type="number" min={-100} max={100} value={total} onChange={e => setTotal(e.target.value)} /></label>}
    <button disabled={controller.pending}>Wykorzystaj reakcję na wejście do cieczy</button>
  </form>;
}
