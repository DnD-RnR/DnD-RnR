import { useState } from 'react';
import type { useBattle } from './LiveBattle';
import type { Combatant } from './battle-types';
import { rageDescription, primalSkills, barbarianSaveAdvantage, dangerSenseDescription, recklessAttackDescription } from '../../../shared/barbarian.mjs';
import definitions from '../../../shared/statistics.json' with { type: 'json' };
type Controller = ReturnType<typeof useBattle>;

function RelentlessForm({ f, controller }: { f: Combatant; controller: Controller }) {
  const [roll, setRoll] = useState('');
  const [roll2, setRoll2] = useState('');
  const [advantage, setAdvantage] = useState(false), [disadvantage, setDisadvantage] = useState(false);
  return <form className="stack-form" onSubmit={e => { e.preventDefault(); void controller.mutate('act', { kind: 'relentless-rage', actorId: f.id, roll: Number(roll), roll2: Number(roll2), advantage, disadvantage }); }}>
    <p>{f.name}: Relentless Rage — rzut obronny na Kondycję, ST {f.relentlessRagePending!.dc}. Sukces: {2 * (f.level ?? 0)} PW.</p>
    <label>k20<input required type="number" min={1} max={20} value={roll} onChange={e => setRoll(e.target.value)} /></label>
    <label><input type="checkbox" checked={advantage} onChange={e => setAdvantage(e.target.checked)} />Ułatwienie</label>
    <label><input type="checkbox" checked={disadvantage} onChange={e => setDisadvantage(e.target.checked)} />Utrudnienie</label>
    {advantage !== disadvantage && <label>Drugi k20<input required type="number" min={1} max={20} value={roll2} onChange={e => setRoll2(e.target.value)} /></label>}
    <button disabled={controller.pending}>Rozstrzygnij</button><button type="button" disabled={controller.pending} onClick={() => void controller.mutate('act', { kind: 'relentless-rage', actorId: f.id, decline: true })}>Zrezygnuj</button>
  </form>;
}

function CheckForm({ f, controller }: { f: Combatant; controller: Controller }) {
  const [kind, setKind] = useState('ability-check');
  const [ability, setAbility] = useState('str'), [skill, setSkill] = useState('');
  const [primal, setPrimal] = useState(false), [advantage, setAdvantage] = useState(false), [disadvantage, setDisadvantage] = useState(false);
  const [roll, setRoll] = useState(''), [roll2, setRoll2] = useState('');
  const primalActive = primal && kind === 'ability-check' && Boolean(f.rage && f.rageProfile?.primalKnowledge && primalSkills.includes(skill));
  const effectiveAbility = primalActive ? 'str' : kind === 'ability-check' && skill ? definitions.skills.find(s => s.id === skill)!.ability : ability;
  const autoAdvantage = kind === 'saving-throw' ? barbarianSaveAdvantage(f, effectiveAbility) : Boolean(f.rage && effectiveAbility === 'str');
  return <details><summary>Test cechy / rzut obronny</summary><form className="stack-form" onSubmit={e => { e.preventDefault(); void controller.mutate('act', { kind, actorId: f.id, ability, skill: kind === 'ability-check' ? skill : '', primal: primalActive, advantage, disadvantage, roll: Number(roll), roll2: Number(roll2) }); }}>
    <label>Rodzaj<select value={kind} onChange={e => setKind(e.target.value)}><option value="ability-check">Test cechy</option><option value="saving-throw">Rzut obronny</option></select></label>
    <label>Cecha<select value={ability} onChange={e => { setAbility(e.target.value); setSkill(''); }}>{definitions.abilities.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}</select></label>
    {kind === 'ability-check' && <label>Umiejętność<select value={skill} onChange={e => setSkill(e.target.value)}><option value="">Bez umiejętności</option>{definitions.skills.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>}
    {f.rage && f.rageProfile?.primalKnowledge && primalSkills.includes(skill) && kind === 'ability-check' && <label><input type="checkbox" checked={primal} onChange={e => setPrimal(e.target.checked)} />Primal Knowledge — użyj Siły</label>}
    {autoAdvantage && <p>{effectiveAbility === 'dex' ? 'Danger Sense daje ułatwienie rzutu obronnego na Zręczność.' : 'Szał daje ułatwienie do Siły.'}</p>}
    <label>k20<input required type="number" min={1} max={20} value={roll} onChange={e => setRoll(e.target.value)} /></label>
    <label><input type="checkbox" checked={advantage} onChange={e => setAdvantage(e.target.checked)} />Ułatwienie</label><label><input type="checkbox" checked={disadvantage} onChange={e => setDisadvantage(e.target.checked)} />Utrudnienie</label>
    {(advantage || autoAdvantage) !== disadvantage && <label>Drugi k20<input required type="number" min={1} max={20} value={roll2} onChange={e => setRoll2(e.target.value)} /></label>}
    <button disabled={controller.pending}>Zapisz wynik w dzienniku</button>
  </form></details>;
}

export function BarbarianControls({ controller }: { controller: Controller }) {
  const b = controller.response!.battle!;
  const [feet, setFeet] = useState('0');
  return <>{b.fighters.filter(f => f.rageProfile?.max).map(f => {
    const controlled = controller.response!.controlledIds.includes(f.id);
    const ownTurn = b.fighters[b.turn].id === f.id;
    const disabled = controller.pending || Boolean(b.pending) || b.fighters.some(a => a.relentlessRagePending || a.concentrationDC);
    return <section className="card" key={f.id} aria-label={`Szał: ${f.name}`}>
      <h3>{f.name}: Szał {f.rageUses}/{f.rageProfile!.max} · {f.rage ? 'aktywny' : 'nieaktywny'}</h3>
      <details><summary>Zasady Szału</summary><p>{rageDescription({ class: 'Barbarian', level: f.level ?? 1 })}</p></details>
      {f.rageProfile!.dangerSense && <details><summary>Danger Sense i Reckless Attack</summary><p>{dangerSenseDescription}</p><p>{recklessAttackDescription}</p></details>}
      {f.recklessActive && <p role="status">Reckless Attack aktywny: ataki z Siły i wszystkie ataki przeciwko tej postaci mają ułatwienie do początku jej następnej tury.</p>}
      {f.rage && <p>Odporność: obuchowe, kłute, cięte. +{f.rageProfile!.damage} obrażeń z Siły. Ułatwienie testów i rzutów obronnych na Siłę. Bez czarów i koncentracji. {f.rageProfile!.persistent ? `Do rundy ${f.rage.maxRound}.` : `Do końca własnej tury w rundzie ${f.rage.expiresRound}; limit: runda ${f.rage.maxRound}.`}</p>}
      {Boolean(f.pounceMoved) && <p>Instinctive Pounce: dodatkowy ruch {f.pounceMoved} stóp przy aktywacji.</p>}
      {controlled && f.relentlessRagePending && <RelentlessForm f={f} controller={controller} />}
      {controlled && !f.relentlessRagePending && <>
        {ownTurn && !f.bonus && !f.rage && f.rageProfile!.instinctivePounce && <label>Instinctive Pounce: ruch przy aktywacji<input type="number" min={0} max={Math.floor(f.speed / 2)} value={feet} onChange={e => setFeet(e.target.value)} /></label>}
        {ownTurn && !f.bonus && !(f.rage && f.rageProfile!.persistent) && <button disabled={disabled || f.hp <= 0 || f.incapacitated || f.unconscious || !f.rage && !f.rageUses} onClick={() => void controller.mutate('act', { kind: f.rage ? 'rage-extend' : 'rage', feet: Number(feet) })}>{f.rage ? 'Przedłuż Szał (akcja dodatkowa)' : 'Włącz Szał (akcja dodatkowa)'}</button>}
        {f.rage && <button disabled={disabled} onClick={() => void controller.mutate('act', { kind: 'rage-end', actorId: f.id })}>Zakończ Szał</button>}
        {f.rageRecoveryOffered && <button disabled={disabled} onClick={() => void controller.mutate('act', { kind: 'rage-recover', actorId: f.id })}>Persistent Rage: odzyskaj użycia po inicjatywie</button>}
        <CheckForm f={f} controller={controller} />
      </>}
      {controller.response!.gm && <div>{(['incapacitated', 'unconscious'] as const).map(condition => <label key={condition}><input type="checkbox" checked={Boolean(f[condition])} disabled={controller.pending} onChange={e => void controller.mutate('act', { kind: 'condition', actorId: f.id, condition, enabled: e.target.checked })} />{condition === 'incapacitated' ? 'Obezwładniony' : 'Nieprzytomny'}</label>)}{ownTurn && f.rage && b.fighters.filter(t => !t.characterId && t.hp > 0).map(t => <button key={t.id} disabled={disabled} onClick={() => void controller.mutate('act', { kind: 'rage-force-save', actorId: f.id, targetId: t.id })}>Potwierdź wymuszenie rzutu: {t.name}</button>)}</div>}
    </section>;
  })}</>;
}
