import { brutalSaveDisadvantage } from '../../../shared/barbarian.mjs';
import { HalflingLuck, halflingFields } from './HalflingLuck';
import { speciesSaveAdvantage } from '../../../shared/species.mjs';
import { automaticCheckFailure, automaticSaveFailure, conditionCheckDisadvantage, conditionCheckAdvantage, socialAdvantage, conditionSaveDisadvantage, conditionSaveAdvantage } from '../../../shared/conditions.mjs';
import { TimedRollInputs } from './TimedEffectControls';
import { LuckInput } from './LuckInput';
import { hexDisadvantage } from '../../../shared/warlock.mjs';
import { useState } from 'react';
import type { useBattle } from './LiveBattle';
import type { Combatant } from './battle-types';
import { rageDescription, primalSkills, barbarianSaveAdvantage, dangerSenseDescription, recklessAttackDescription } from '../../../shared/barbarian.mjs';
import definitions from '../../../shared/statistics.json' with { type: 'json' };
type Controller = ReturnType<typeof useBattle>;

function RelentlessForm({ f, controller }: { f: Combatant; controller: Controller }) {
  const [timed, setTimed] = useState<Record<string, number>>({});
  const [fanaticalRoll, setFanaticalRoll] = useState(''), [fanaticalRoll2, setFanaticalRoll2] = useState('');
  const [roll, setRoll] = useState('');
  const [roll2, setRoll2] = useState('');
  const [advantage, setAdvantage] = useState(false), [disadvantage, setDisadvantage] = useState(false);
  return <form className="stack-form" onSubmit={e => { e.preventDefault(); void controller.mutate('act', { kind: 'relentless-rage', ...(fanaticalRoll ? { fanaticalRoll: Number(fanaticalRoll), fanaticalRoll2: Number(fanaticalRoll2) } : {}), ...timed, ...halflingFields(e.currentTarget), actorId: f.id, roll: Number(roll), roll2: Number(roll2), advantage, disadvantage }); }}>
    <TimedRollInputs actor={f} values={timed} onChange={setTimed} />{f.spellConditions?.some(e => e.kind === 'mind-sliver') && <label>Mind Sliver k4<input required type="number" min={1} max={4} value={timed.mindSliverRoll ?? ''} onChange={e => setTimed({ ...timed, mindSliverRoll: Number(e.target.value) })} /></label>}{f.rageProfile?.zealot && !f.rage?.fanaticalUsed && <fieldset><legend>Fanatical Focus po porażce (opcjonalnie, raz na Szał)</legend><label>Nowa k20<input type="number" min={1} max={20} value={fanaticalRoll} onChange={e => setFanaticalRoll(e.target.value)} /></label><label>Druga nowa k20, jeśli wymagana<input type="number" min={1} max={20} value={fanaticalRoll2} onChange={e => setFanaticalRoll2(e.target.value)} /></label></fieldset>}<HalflingLuck species={f.species} /><p>{f.name}: Relentless Rage — rzut obronny na Kondycję, ST {f.relentlessRagePending!.dc}. Sukces: {2 * (f.level ?? 0)} PW.</p>
    <label>k20<input required type="number" min={1} max={20} value={roll} onChange={e => setRoll(e.target.value)} /></label>
    <label><input type="checkbox" checked={advantage} onChange={e => setAdvantage(e.target.checked)} />Ułatwienie</label>
    <label><input type="checkbox" checked={disadvantage} onChange={e => setDisadvantage(e.target.checked)} />Utrudnienie</label>
    {(advantage || barbarianSaveAdvantage(f, 'con')) !== (disadvantage || brutalSaveDisadvantage(f)) && <label>Drugi k20<input required type="number" min={1} max={20} value={roll2} onChange={e => setRoll2(e.target.value)} /></label>}
    <button disabled={controller.pending}>Rozstrzygnij</button><button type="button" disabled={controller.pending} onClick={() => void controller.mutate('act', { kind: 'relentless-rage', actorId: f.id, decline: true })}>Zrezygnuj</button>
  </form>;
}

export function CheckForm({ f, controller }: { f: Combatant; controller: Controller }) {
  const [saveCondition, setSaveCondition] = useState('');
  const [luck, setLuck] = useState('');
  const [kind, setKind] = useState('ability-check');
  const [mindSliverRoll, setMindSliverRoll] = useState('');
  const [timedRolls, setTimedRolls] = useState<Record<string, number>>({});
  const [ability, setAbility] = useState('str'), [skill, setSkill] = useState('');
  const [lightlyObscured, setLightlyObscured] = useState(false);
  const [socialTargetId, setSocialTargetId] = useState('');
  const [requiresSight, setRequiresSight] = useState(false), [requiresHearing, setRequiresHearing] = useState(false);
  const [primal, setPrimal] = useState(false), [advantage, setAdvantage] = useState(false), [disadvantage, setDisadvantage] = useState(false);
  const [roll, setRoll] = useState(''), [roll2, setRoll2] = useState('');
  const primalActive = primal && kind === 'ability-check' && Boolean(f.rage && f.rageProfile?.primalKnowledge && primalSkills.includes(skill));
  const effectiveAbility = primalActive ? 'str' : kind === 'ability-check' && skill ? definitions.skills.find(s => s.id === skill)!.ability : ability;
  const autoAdvantage = kind === 'saving-throw' ? (speciesSaveAdvantage(f, effectiveAbility, saveCondition) || barbarianSaveAdvantage(f, effectiveAbility) || conditionSaveAdvantage(f, effectiveAbility)) : (Boolean((f.rage || f.speciesEffects?.large) && effectiveAbility === 'str') || conditionCheckAdvantage(f, effectiveAbility)) || kind === 'ability-check' && socialAdvantage(f, controller.response!.battle!.fighters.find(t => t.id === socialTargetId));
  const autoFailure = kind === 'saving-throw' ? automaticSaveFailure(f, effectiveAbility) : automaticCheckFailure(f, { requiresSight, requiresHearing });
  const autoDisadvantage = (kind === 'saving-throw' ? brutalSaveDisadvantage(f) || conditionSaveDisadvantage(f, effectiveAbility) : (conditionCheckDisadvantage(f, effectiveAbility) || skill === 'perception' && requiresSight && lightlyObscured)) || hexDisadvantage(controller.response!.battle!, f, effectiveAbility, kind === 'saving-throw') || f.spellConditions?.some(e => e.kind === 'enfeebled' && effectiveAbility === 'str' || e.kind === 'poisoned' && kind === 'ability-check');
  return <details><summary>Test cechy / rzut obronny</summary><form className="stack-form" onSubmit={e => { e.preventDefault(); void controller.mutate('act', { kind, condition: saveCondition, ...halflingFields(e.currentTarget), requiresSight, requiresHearing, lightlyObscured, socialTargetId, ...timedRolls, mindSliverRoll: Number(mindSliverRoll), ...(luck ? { luckRoll: Number(luck) } : {}), actorId: f.id, ability, skill: kind === 'ability-check' ? skill : '', primal: primalActive, advantage, disadvantage, roll: Number(roll), roll2: Number(roll2) }); }}>
    {kind === 'saving-throw' && !autoFailure && f.spellConditions?.some(e => e.kind === 'mind-sliver') && <label>Mind Sliver: odejmij k4<input required type="number" min={1} max={4} value={mindSliverRoll} onChange={e => setMindSliverRoll(e.target.value)} /></label>}
    {kind === 'saving-throw' && !autoFailure && <TimedRollInputs actor={f} values={timedRolls} onChange={setTimedRolls} />}
    <label>Rodzaj<select value={kind} onChange={e => setKind(e.target.value)}><option value="ability-check">Test cechy</option><option value="saving-throw">Rzut obronny</option></select></label>
    {kind === 'saving-throw' && <label>Stan, któremu zapobiegasz lub który kończysz<select value={saveCondition} onChange={e => setSaveCondition(e.target.value)}><option value="">Nie dotyczy</option><option value="charmed">Charmed</option><option value="frightened">Frightened</option><option value="poisoned">Poisoned</option></select></label>}
    <label>Cecha<select value={ability} onChange={e => { setAbility(e.target.value); setSkill(''); }}>{definitions.abilities.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}</select></label>
    {kind === 'ability-check' && <label>Umiejętność<select value={skill} onChange={e => setSkill(e.target.value)}><option value="">Bez umiejętności</option>{definitions.skills.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>}
    {f.rage && f.rageProfile?.primalKnowledge && primalSkills.includes(skill) && kind === 'ability-check' && <label><input type="checkbox" checked={primal} onChange={e => setPrimal(e.target.checked)} />Primal Knowledge — użyj Siły</label>}
    {autoAdvantage && <p>{effectiveAbility === 'dex' ? 'Haste lub cecha postaci daje ułatwienie rzutu DEX.' : 'Stan, Szał lub interakcja ze stworzeniem Charmed daje ułatwienie.'}</p>}
    {kind === 'ability-check' && <><label><input type="checkbox" checked={lightlyObscured} onChange={e => setLightlyObscured(e.target.checked)} />MG potwierdza lekkie przesłonięcie dla wzrokowej Perception (np. Web).</label><label><input type="checkbox" checked={requiresSight} onChange={e => setRequiresSight(e.target.checked)} />Test wymaga wzroku (potwierdza MG)</label><label><input type="checkbox" checked={requiresHearing} onChange={e => setRequiresHearing(e.target.checked)} />Test wymaga słuchu (potwierdza MG)</label></>}
    {kind === 'ability-check' && <label>Cel interakcji społecznej (MG potwierdza)<select value={socialTargetId} onChange={e => setSocialTargetId(e.target.value)}><option value="">Nie dotyczy</option>{controller.response!.battle!.fighters.filter(t => t.id !== f.id).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>}
    {autoFailure && <p>Stan powoduje automatyczną porażkę rzutu.</p>}
    <HalflingLuck species={f.species} /><label>k20<input required={!autoFailure} type="number" min={1} max={20} value={roll} onChange={e => setRoll(e.target.value)} /></label>
    <label><input type="checkbox" checked={advantage} onChange={e => setAdvantage(e.target.checked)} />Ułatwienie</label><label><input type="checkbox" checked={disadvantage} onChange={e => setDisadvantage(e.target.checked)} />Utrudnienie</label>
    {!autoFailure && (advantage || autoAdvantage) !== (disadvantage || autoDisadvantage) && <label>Drugi k20<input required type="number" min={1} max={20} value={roll2} onChange={e => setRoll2(e.target.value)} /></label>}
    {autoDisadvantage && <p>Stan lub zdolność daje utrudnienie tego rzutu.</p>}<LuckInput actor={f} value={luck} onChange={setLuck} />
    <button disabled={controller.pending}>Zapisz wynik w dzienniku</button>
  </form></details>;
}

export function BarbarianControls({ controller }: { controller: Controller }) {
  const b = controller.response!.battle!;
  const [feet, setFeet] = useState('0');
  const [animal, setAnimal] = useState('bear'), [power, setPower] = useState('falcon'), [divineForm, setDivineForm] = useState(false);
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
        {ownTurn && !f.bonus && !f.rage && f.rageProfile?.wildHeart && <><label>Rage of the Wilds<select value={animal} onChange={e => setAnimal(e.target.value)}>{['bear', 'eagle', 'wolf'].map(id => <option key={id}>{id}</option>)}</select></label>{(f.level ?? 0) >= 14 && <label>Power of the Wilds<select value={power} onChange={e => setPower(e.target.value)}>{['falcon', 'lion', 'ram'].map(id => <option key={id}>{id}</option>)}</select></label>}</>}
        {ownTurn && !f.bonus && !f.rage && f.rageProfile?.zealot && (f.level ?? 0) >= 14 && <label><input type="checkbox" checked={divineForm} onChange={e => setDivineForm(e.target.checked)} />Rage of the Gods przy aktywacji (raz na d?ugi odpoczynek)</label>}
        {ownTurn && !f.bonus && !(f.rage && f.rageProfile!.persistent) && <button disabled={disabled || f.hp <= 0 || f.incapacitated || f.unconscious || !f.rage && !f.rageUses} onClick={() => void controller.mutate('act', { kind: f.rage ? 'rage-extend' : 'rage', feet: Number(feet), ...(f.rageProfile?.wildHeart ? { animal, power } : {}), divineForm })}>{f.rage ? 'Przedłuż Szał (akcja dodatkowa)' : 'Włącz Szał (akcja dodatkowa)'}</button>}
        {f.rage && <button disabled={disabled} onClick={() => void controller.mutate('act', { kind: 'rage-end', actorId: f.id })}>Zakończ Szał</button>}
        {f.rageRecoveryOffered && <button disabled={disabled} onClick={() => void controller.mutate('act', { kind: 'rage-recover', actorId: f.id })}>Persistent Rage: odzyskaj użycia po inicjatywie</button>}
        <CheckForm f={f} controller={controller} />
      </>}
      {controller.response!.gm && <div>{(['incapacitated', 'unconscious'] as const).map(condition => <label key={condition}><input type="checkbox" checked={Boolean(f[condition])} disabled={controller.pending} onChange={e => void controller.mutate('act', { kind: 'condition', actorId: f.id, condition, enabled: e.target.checked })} />{condition === 'incapacitated' ? 'Obezwładniony' : 'Nieprzytomny'}</label>)}{ownTurn && f.rage && b.fighters.filter(t => !t.characterId && t.hp > 0).map(t => <button key={t.id} disabled={disabled} onClick={() => void controller.mutate('act', { kind: 'rage-force-save', actorId: f.id, targetId: t.id })}>Potwierdź wymuszenie rzutu: {t.name}</button>)}</div>}
    </section>;
  })}</>;
}
