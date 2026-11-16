import { spellDamageDice } from '../../../shared/spell-damage.mjs';
import { automaticSaveFailure, conditionAttackModifiers, conditionDefinitions, conditionSaveDisadvantage, hasCondition } from '../../../shared/conditions.mjs';
import { strongestEffects } from '../../../shared/timed-effects.mjs';
import { TimedRollInputs } from './TimedEffectControls';
import { LuckInput } from './LuckInput';
import { bondAdvantage, hexDisadvantage } from '../../../shared/warlock.mjs';
import { useState } from 'react';
import { barbarianSaveAdvantage, barbarianAttackAdvantage } from '../../../shared/barbarian.mjs';
import type { Combatant } from './battle-types';
import type { useBattle } from './LiveBattle';
type Controller = ReturnType<typeof useBattle>;

export function DelayedSpellControls({ controller }: { controller: Controller }) {
  const response = controller.response!, b = response.battle!, current = b.fighters[b.turn];
  const effects = b.delayedSpellDamage ?? [];
  if (!effects.length) return null;
  return <section className="card"><h2>Obrażenia na koniec następnej tury celu</h2>
    {effects.map(e => <div key={e.id}><p>{e.spellName} → {b.fighters.find(f => f.id === e.targetId)?.name}: {e.dice}k{e.sides} {e.type}, koniec tury w rundzie {e.round}.</p>
      {e.targetId === current.id && e.round <= b.round && (response.gm || response.controlledIds.includes(current.id)) && <button disabled={controller.pending || Boolean(b.pending)} onClick={() => void controller.mutate('act', { kind: 'delayed-spell', actorId: current.id, effectId: e.id })}>Rozlicz na koniec tury</button>}
    </div>)}
    <p>Rozliczenie kończy możliwość działania w tej turze. Jeśli kilka efektów przypada na jej koniec, wybierz ich kolejność. Dokończ je przed zakończeniem walki.</p>
  </section>;
}

export function SpellConditionControls({ controller, actor }: { controller: Controller; actor: Combatant }) {
  const [roll, setRoll] = useState(''), [roll2, setRoll2] = useState('');
  const [mindSliverRoll, setMindSliverRoll] = useState('');
  const [timedRolls, setTimedRolls] = useState<Record<string, number>>({});
  const [advantage, setAdvantage] = useState(false), [disadvantage, setDisadvantage] = useState(false);
  const b = controller.response!.battle!;
  const controlled = controller.response!.controlledIds.includes(actor.id);
  const effects = actor.spellConditions ?? [];
  const timedRepeat = strongestEffects(actor.timedEffects).find(e => e.modifiers.repeatSave && e.lastSaveRound !== b.round);
  const repeat: { kind: string; sourceId: string; save?: string; dc?: number; effectId?: string } | undefined = timedRepeat ? { kind: timedRepeat.modifiers.condition ?? timedRepeat.spellId, sourceId: timedRepeat.sourceFighterId, save: timedRepeat.modifiers.repeatSave ?? undefined, dc: timedRepeat.dc, effectId: timedRepeat.id } : effects.find(e => e.concentrationKey && e.lastSaveRound !== b.round);
  return <>{effects.filter(e => !conditionDefinitions[e.kind]).map(e => <p key={`${e.kind}:${e.sourceId}`}>Efekt: {({ paralyzed: 'Paralyzed — brak działań i ruchu', poisoned: 'Poisoned — utrudnienie ataków i testów cech', 'chill-touch': 'Chill Touch — brak odzyskiwania PW', enfeebled: 'Ray of Enfeeblement — utrudnienie testów Siły i −k8 obrażeń', 'guiding-bolt': 'Guiding Bolt — ułatwienie następnego ataku przeciw celowi', 'ray-of-frost': 'Ray of Frost — szybkość -10 stóp', wrath: 'Wrath — szybkość -10 stóp', 'shocking-grasp': 'Shocking Grasp — brak ataków okazyjnych', 'starry-wisp': 'Starry Wisp — światło, brak korzyści z Invisible (widoczność ustala MG)', 'mind-sliver': 'Mind Sliver — -k4 do następnego rzutu obronnego', 'no-reactions': 'Arms of Hadar — brak reakcji', 'enfeebled-miss': 'Utrudnienie następnego ataku' } as Record<string, string>)[e.kind] ?? e.kind}</p>)}
    {repeat && controlled && actor.id === b.fighters[b.turn].id && <form className="stack-form" onSubmit={e => { e.preventDefault(); void controller.mutate('act', { kind: 'condition-save', actorId: actor.id, sourceId: repeat.sourceId, condition: repeat.kind, effectId: repeat.effectId, ...timedRolls, mindSliverRoll: Number(mindSliverRoll), roll: Number(roll), roll2: Number(roll2), advantage, disadvantage }); }}>
      {actor.spellConditions?.some(e => e.kind === 'mind-sliver') && <label>Mind Sliver: odejmij k4<input required type="number" min={1} max={4} value={mindSliverRoll} onChange={e => setMindSliverRoll(e.target.value)} /></label>}
      <TimedRollInputs actor={actor} values={timedRolls} onChange={setTimedRolls} />
      <p>Na koniec tury: {repeat.save?.toUpperCase()}, ST {repeat.dc}. Wykonanie rzutu kończy możliwość działania w tej turze.</p>
      <label>k20<input required type="number" min={1} max={20} value={roll} onChange={e => setRoll(e.target.value)} /></label>
      <label><input type="checkbox" checked={advantage} onChange={e => setAdvantage(e.target.checked)} />Ułatwienie</label><label><input type="checkbox" checked={disadvantage} onChange={e => setDisadvantage(e.target.checked)} />Utrudnienie</label>
      <label>Drugi k20 (przy ułatwieniu lub utrudnieniu)<input type="number" min={1} max={20} value={roll2} onChange={e => setRoll2(e.target.value)} /></label>
      <button disabled={controller.pending || Boolean(b.pending)}>Powtórz rzut na koniec tury</button>
    </form>}
  </>;
}

export function SpellCastForm({ controller, actor, slot }: { controller: Controller; actor: Combatant; slot: 'action' | 'bonus' | 'reaction' }) {
  const c = actor.spellcasting!;
  const spells = c.spells.filter(s => s.action === slot);
  const [psychic, setPsychic] = useState(false), [hexAbility, setHexAbility] = useState('str');
  const [spellId, setSpellId] = useState('');
  const [resource, setResource] = useState('');
  const [targetIds, setTargetIds] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [confirmedHumanoid, setConfirmedHumanoid] = useState(false);
  const [conditionChoice, setConditionChoice] = useState('blinded');
  const spell = spells.find(s => s.id === spellId);
  const b = controller.response!.battle!;
  const resources = spell?.level === 0 ? [{ key: 'cantrip:0', label: 'Sztuczka — bez miejsca na czar' }] : [
    ...(spell?.legacyFreeCast ? [{ key: `legacy:${spell.level}`, label: 'Fiendish Legacy — bez slotu / długi odpoczynek' }] : []),
    ...c.slots.filter(s => s.remaining > 0 && s.level >= (spell?.level ?? 10)).map(s => ({ key: `${s.source}:${s.level}`, label: `${s.level}. krąg · ${s.remaining}/${s.total}${s.source === 'pact' ? ' · Pact Magic' : ''}` })),
    ...(spell?.arcanumRemaining ? [{ key: `arcanum:${spell.level}`, label: 'Mystic Arcanum — 1 użycie / długi odpoczynek' }] : []),
    ...(spell?.originFreeCast ? [{ key: `origin:${spell.level}`, label: 'Atut Origin — bez miejsca / długi odpoczynek' }] : []),
  ];
  const selectedResource = resources.find(r => r.key === resource)?.key ?? resources[0]?.key ?? '';
  const [source, level] = selectedResource.split(':');
  const projectileCount = spell?.effect?.cantripBeams ? (actor.level ?? 1) >= 17 ? 4 : (actor.level ?? 1) >= 11 ? 3 : (actor.level ?? 1) >= 5 ? 2 : 1 : spell?.effect?.projectiles ? spell.effect.projectiles + (Number(level) - spell.level) * (spell.effect.projectilesPerLevel ?? 0) : 0;
  const slotUsed = (b.slotCasters ?? []).includes(actor.id) && spell?.level !== 0 && !['arcanum', 'origin', 'legacy', 'paladin-smite'].includes(source);
  return <form className="stack-form" onSubmit={e => {
    e.preventDefault();
    void controller.mutate('act', { kind: 'cast', actorId: actor.id, slot, spellId, source, level: Number(level), targetIds, psychic, hexAbility, confirmedHumanoid, conditionChoice });
  }}>
    <p>Miejsca na czary: {c.slots.map(s => `${s.level}. krąg: ${s.remaining}/${s.total}${s.source === 'pact' ? ' (Pact)' : ''}`).join(' · ') || 'Brak'}</p>
    {c.error && <p className="form-error" role="alert">{c.error}</p>}
    <label>Dostępny czar<select required value={spellId} onChange={e => { setSpellId(e.target.value); setResource(''); setTargetIds([]); setConfirmed(false); }}><option value="">Wybierz czar</option>{spells.map(s => <option key={s.id} value={s.id}>{s.name} · {s.level ? `${s.level}. krąg` : 'sztuczka'}{s.effect ? '' : ' · efekty rozstrzyga GM'}</option>)}</select></label>
    {spell && <>
      {spell.effect?.conditionOptions && <label>Stan<select required value={conditionChoice} onChange={e => setConditionChoice(e.target.value)}>{spell.effect.conditionOptions.map(id => <option key={id} value={id}>{conditionDefinitions[id]?.label ?? id}</option>)}</select></label>}
      {spell.effect?.humanoid && <label><input required type="checkbox" checked={confirmedHumanoid} onChange={e => setConfirmedHumanoid(e.target.checked)} />MG potwierdza, że wybrane cele są Humanoidami.</label>}
      <p>Cecha czarowania: {spell.spellcastingAbility?.toUpperCase() || '—'} · Atak {spell.attack === null ? '—' : `${spell.attack >= 0 ? '+' : ''}${spell.attack}`} · ST {spell.dc ?? '—'}</p>
      <label>Miejsce na czar / źródło<select required value={selectedResource} onChange={e => setResource(e.target.value)}>{!resources.length && <option value="">Brak dostępnego zasobu</option>}{resources.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}</select></label>
      {c.warlock?.greatOldOne && <><label><input type="checkbox" checked={psychic} onChange={e => setPsychic(e.target.checked)} />Psychic Spells: zamień obrażenia czaru Warlocka na psychiczne</label><p>Enchantment i Illusion możesz rzucać bez V i S. Komponenty M nadal obowiązują.</p></>}
      {spell.id === 'hex' && <label>Hex: cecha<select value={hexAbility} onChange={e => setHexAbility(e.target.value)}>{['str','dex','con','int','wis','cha'].map(a => <option key={a} value={a}>{a.toUpperCase()}</option>)}</select></label>}
      {spell.effect?.gmNote && <p>{spell.effect.gmNote}</p>}
      <p>{spell.range} · {spell.duration}</p><p className="item-description">{spell.description}</p>{spell.upgrade && <p>{spell.upgrade}</p>}
      {!spell.effect && <p>Ten czar zużyje właściwy zasób, a jego efekty i rzuty rozstrzygnie GM. Nie ma jeszcze pełnej automatyzacji tego efektu.</p>}
      {slotUsed && <p role="status">W tej turze wykorzystano już miejsce na czar. Dostępna może być sztuczka lub źródło niewymagające miejsca.</p>}
      {projectileCount > 0 && <fieldset><legend>Cele promieni (osobny atak i obrażenia dla każdego)</legend>{Array.from({ length: projectileCount }, (_, i) => <label key={i}>Promień {i + 1}<select required value={targetIds[i] ?? ''} onChange={e => setTargetIds(Array.from({ length: projectileCount }, (_, n) => n === i ? e.target.value : targetIds[n] ?? ''))}><option value="">Wybierz cel</option>{b.fighters.filter(f => f.hidden || f.deathFailures < 3).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>)}</fieldset>}
      {!projectileCount && (spell.id === 'hex' || spell.effect && !['shield', 'temp-hp'].includes(spell.effect.mode)) && <fieldset><legend>{(spell.effect?.area || spell.effect?.extraTargets) ? 'Cele w obszarze (uzgodnij z GM)' : 'Cel czaru'}</legend>{b.fighters.filter(f => f.hidden || f.deathFailures < 3).map(f => <label className="battle-check" key={f.id}><input type={(spell.effect?.area || spell.effect?.extraTargets) ? 'checkbox' : 'radio'} name="spell-target" checked={targetIds.includes(f.id)} onChange={e => setTargetIds((spell.effect?.area || spell.effect?.extraTargets) ? e.target.checked ? [...targetIds, f.id] : targetIds.filter(id => id !== f.id) : [f.id])} />{f.name}</label>)}</fieldset>}
      <label className="battle-check"><input required type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />Potwierdzam z GM zasięg, widoczność, komponenty i ewentualny wyzwalacz reakcji.</label>
      <button className="primary-button" disabled={controller.pending || !selectedResource || slotUsed || Boolean(c.error) || (Boolean(spell.effect) && !['shield', 'temp-hp'].includes(spell.effect?.mode ?? '') && !spell.effect?.zone && !targetIds.length)}>Rzuć czar</button>
    </>}
  </form>;
}

export function SpellResolution({ controller }: { controller: Controller }) {
  const b = controller.response!.battle!, p = b.pending;
  const [roll, setRoll] = useState('');
  const [roll2, setRoll2] = useState('');
  const [advantage, setAdvantage] = useState(false);
  const [reckless, setReckless] = useState(false);
  const [disadvantage, setDisadvantage] = useState(false);
  const [rolls, setRolls] = useState<string[]>([]);
  const [hexEnfeeblementRoll, setHexEnfeeblementRoll] = useState('');
  const [mindSliverRoll, setMindSliverRoll] = useState('');
  const [timedRolls, setTimedRolls] = useState<Record<string, number>>({});
  const [enfeeblementRoll, setEnfeeblementRoll] = useState(''), [within5Feet, setWithin5Feet] = useState(false);
  const [hexRolls, setHexRolls] = useState<string[]>([]), [luck, setLuck] = useState('');
  if (p?.kind !== 'spell') return null;
  const caster = b.fighters.find(f => f.id === p.actorId)!;
  const canCast = controller.response!.controlledIds.includes(caster.id) || Boolean((p.delayedDamageId || p.zoneEvent) && controller.response!.gm);
  const damageSource = p.delayedDamageId || p.zoneEvent ? b.fighters.find(f => f.id === p.sourceId) : caster;
  const target = p.stage === 'save' ? p.targets.find(t => t.saved === undefined && controller.response!.controlledIds.includes(t.id)) : null;
  const baseAutomaticDisadvantage = p.stage === 'attack' && (caster.spellConditions?.some(e => ['poisoned', 'enfeebled-miss'].includes(e.kind)) || Boolean(caster.mockery) || b.fighters.some(f => p.targets.some(t => t.id === f.id) && (f.dodge || f.attackDisadvantage)));
  const savingTarget = b.fighters.find(f => f.id === target?.id);
  const attackTarget = b.fighters.find(f => f.id === p.targets[0]?.id);
  const conditionModifiers = conditionAttackModifiers(caster, attackTarget, { within5Feet });
  const autoFailure = p.stage === 'save' && savingTarget && automaticSaveFailure(savingTarget, p.spec.save ?? '');
  const automaticDisadvantage = conditionModifiers.disadvantage && p.stage === 'attack' || Boolean(savingTarget && conditionSaveDisadvantage(savingTarget, p.spec.save ?? '')) || baseAutomaticDisadvantage || (p.stage === 'attack' ? bondAdvantage(attackTarget, caster) : Boolean(savingTarget && hexDisadvantage(b, savingTarget, p.spec.save ?? '')));
  const canReckless = p.stage === 'attack' && b.fighters[b.turn].id === caster.id && caster.rageProfile?.recklessAttack && !caster.attackRollMade;
  const automaticAdvantage = p.stage === 'save' ? Boolean(savingTarget && barbarianSaveAdvantage(savingTarget, p.spec.save)) : p.stage === 'attack' && (conditionModifiers.advantage || attackTarget?.spellConditions?.some(e => ['paralyzed', 'guiding-bolt'].includes(e.kind)) || barbarianAttackAdvantage(caster, attackTarget) || bondAdvantage(caster, attackTarget));
  const needsTwo = (advantage || automaticAdvantage) !== (disadvantage || automaticDisadvantage);
  if (p.stage === 'save' && !target) return <p role="status">{p.spellName}: oczekiwanie na rzuty obronne celów.</p>;
  if (p.stage !== 'save' && !canCast) return <p role="status">{p.spellName}: oczekiwanie na rzuty osoby rzucającej czar.</p>;
  const damageDice = spellDamageDice(p.spec, p.critical);
  const count = damageDice.length;
  const defensesReady = ['heal', 'temp-hp'].includes(p.spec.mode) || p.targets.every(t => t.saved && !p.spec.half && !p.spec.successRider || t.defenseReady);
  return <form className="stack-form" onSubmit={e => {
    e.preventDefault();
    void controller.mutate('act', p.stage === 'effect' ? { kind: 'spell-effect', hexEnfeeblementRoll: Number(hexEnfeeblementRoll), enfeeblementRoll: Number(enfeeblementRoll), hexRolls: hexRolls.map(Number), rolls: Array.from({ length: count }, (_, i) => Number(rolls[i])) }
      : { kind: p.stage === 'attack' ? 'spell-attack' : 'spell-save', within5Feet, ...timedRolls, mindSliverRoll: Number(mindSliverRoll), reckless: Boolean(canReckless && reckless), targetId: target?.id, ...(luck ? { luckRoll: Number(luck) } : {}), roll: Number(roll), roll2: Number(roll2), advantage, disadvantage });
  }}>
    {p.stage === 'save' && savingTarget && <LuckInput actor={savingTarget} value={luck} onChange={setLuck} />}
    {p.stage === 'effect' && Boolean(p.hexDice) && damageSource?.spellConditions?.some(e => e.kind === 'enfeebled') && <label>Redukcja obrażeń Hex: k8<input required type="number" min={1} max={8} value={hexEnfeeblementRoll} onChange={e => setHexEnfeeblementRoll(e.target.value)} /></label>}
    {p.stage === 'effect' && Boolean(p.hexDice) && <div>{Array.from({ length: p.hexDice! }, (_, i) => <label key={i}>Hex k6<input required type="number" min={1} max={6} value={hexRolls[i] ?? ''} onChange={e => setHexRolls(prev => { const next = [...prev]; next[i] = e.target.value; return next; })} /></label>)}</div>}
    <h2>{p.spellName}</h2>
    {p.zoneEvent && <p>Efekt chmury: nowy rzut obronny i aktualne odporności celu. Rozliczenie nie zużywa kolejnej akcji ani miejsca na czar.</p>}
    {p.delayedDamageId && <p>Obrażenia opóźnione na koniec tury celu. Bez nowego ataku, rzutu obronnego ani zużycia akcji lub miejsca na czar. MG ponownie zatwierdza aktualną odporność.</p>}
    {p.missed && <p>Pudło: połowa początkowych obrażeń, bez późniejszych obrażeń.</p>}
    {p.stage !== 'effect' && !autoFailure && <TimedRollInputs actor={p.stage === 'save' ? savingTarget : caster} values={timedRolls} onChange={setTimedRolls} />}
    {!autoFailure && p.stage === 'save' && savingTarget?.spellConditions?.some(e => e.kind === 'mind-sliver') && <label>Mind Sliver: odejmij k4<input required type="number" min={1} max={4} value={mindSliverRoll} onChange={e => setMindSliverRoll(e.target.value)} /></label>}
    {p.stage === 'attack' && attackTarget && ['prone', 'paralyzed', 'unconscious'].some(c => hasCondition(attackTarget, c)) && <label><input type="checkbox" checked={within5Feet} onChange={e => setWithin5Feet(e.target.checked)} />MG potwierdza atak z odległości do 5 stóp (Prone / trafienie w bezbronnego).</label>}
    {p.stage === 'effect' && ['attack', 'save'].includes(p.spec.mode) && damageSource?.spellConditions?.some(e => e.kind === 'enfeebled') && <label>Ray of Enfeeblement: odejmij k8<input required type="number" min={1} max={8} value={enfeeblementRoll} onChange={e => setEnfeeblementRoll(e.target.value)} /></label>}{automaticAdvantage && <p>{p.stage === 'attack' ? 'Zdolność postaci daje automatyczne ułatwienie tego ataku.' : p.spec.save === 'dex' ? 'Danger Sense: ułatwienie rzutu obronnego na Zręczność.' : 'Szał: ułatwienie rzutu obronnego na Siłę.'}</p>}
    {canReckless && <label><input type="checkbox" checked={reckless} onChange={e => setReckless(e.target.checked)} />Reckless Attack — wybór przy pierwszym rzucie na atak. Ten czar nie używa Siły, ale ataki przeciwko tobie zyskają ułatwienie.</label>}
    {p.stage !== 'effect' ? autoFailure ? <p>Stan celu powoduje automatyczną porażkę tego rzutu obronnego. Zatwierdź wynik bez rzucania kością.</p> : <>
      <p>{p.stage === 'attack' ? 'Rzut na atak czarem' : `Rzut obronny (${p.spec.save?.toUpperCase()}): ${b.fighters.find(f => f.id === target?.id)?.name}`}</p>
      <label>k20 bez premii<input required type="number" min={1} max={20} value={roll} onChange={e => setRoll(e.target.value)} /></label>
      <label className="battle-check"><input type="checkbox" checked={advantage} onChange={e => setAdvantage(e.target.checked)} />Ułatwienie</label><label className="battle-check"><input type="checkbox" checked={disadvantage} onChange={e => setDisadvantage(e.target.checked)} />Utrudnienie</label>
      {automaticDisadvantage && <p>Ten rzut wymaga utrudnienia.</p>}
      {needsTwo && <label>Drugi k20<input required type="number" min={1} max={20} value={roll2} onChange={e => setRoll2(e.target.value)} /></label>}
    </> : ['condition', 'timed-save', 'timed-condition'].includes(p.spec.mode) ? <p>Po potwierdzeniu odporności przez MG zastosuj wynik rzutów obronnych. Ten czar nie zadaje obrażeń.</p> : <><p>{p.spec.mode === 'temp-hp' ? 'Tymczasowe PW' : p.spec.mode === 'heal' ? 'Leczenie' : 'Obrażenia'}: {p.spec.components ? p.spec.components.map(c => `${c.dice}k${c.sides} ${c.type}`).join(' + ') : `${count}k${p.spec.sides}`}{p.spec.bonus ? ` + ${p.spec.bonus}` : ''}{p.critical ? ' · krytyk' : ''}. Podaj same kości; serwer doda premię i zastosuje wynik rzutu obronnego.</p><div className="battle-fields">{Array.from({ length: count }, (_, i) => <label key={i}>Kość {i + 1}<input required type="number" min={1} max={damageDice[i].sides} placeholder={`k${damageDice[i].sides} ${damageDice[i].type ?? ''}`} value={rolls[i] ?? ''} onChange={e => setRolls(old => { const next = [...old]; next[i] = e.target.value; return next; })} /></label>)}</div></>}
    {p.stage === 'effect' && !defensesReady && <p role="status">Oczekiwanie na GM. W panelu „GM: odporności i podatności” prowadzący musi zatwierdzić efekt obrażeń dla: {p.targets.filter(t => !t.defenseReady && !(t.saved && !p.spec.half)).map(t => b.fighters.find(f => f.id === t.id)?.name).join(', ')}. Jeśli cel nie ma odporności ani podatności, GM wybiera „Zwykłe obrażenia”. Wpisane kości pozostaną zachowane.</p>}
    <button className="primary-button" disabled={controller.pending || p.stage === 'effect' && !defensesReady}>{p.stage === 'effect' && !defensesReady ? 'Oczekiwanie na zatwierdzenie GM' : 'Zatwierdź rzuty'}</button>
  </form>;
}

export function SpellDefenses({ controller }: { controller: Controller }) {
  const b = controller.response!.battle!, p = b.pending;
  const [conditionImmune, setConditionImmune] = useState(false);
  if (p?.kind !== 'spell' || ['heal', 'temp-hp'].includes(p.spec.mode)) return null;
  if (['condition', 'timed-save', 'timed-condition'].includes(p.spec.mode)) return <details open><summary>MG: odporność na efekt — {p.spellName}</summary>{p.targets.filter(t => !t.defenseReady && (!t.saved || p.spec.successRider)).map(t => <div key={t.id}><p>{b.fighters.find(f => f.id === t.id)?.name}</p><button disabled={controller.pending} onClick={() => void controller.mutate('act', { kind: 'spell-defense', targetId: t.id, multiplier: 1, conditionImmune: false })}>Efekt może działać</button><button disabled={controller.pending} onClick={() => void controller.mutate('act', { kind: 'spell-defense', targetId: t.id, multiplier: 1, conditionImmune: true })}>Cel odporny na efekt</button></div>)}</details>;
  return <details open><summary>GM: odporności i podatności — {p.spec.components?.map(c => c.type).join(' + ') ?? p.spec.type}</summary><p>Wybierz wynik zgodny ze statystykami i aktualnymi efektami celu. Odporność Szału na obrażenia obuchowe, kłute i cięte zostanie zastosowana automatycznie (bez podwójnego dzielenia). Aplikacja połączy wybór z rzutem obronnym i obliczy końcowe obrażenia.</p>{p.spec.rider && <label><input type="checkbox" checked={conditionImmune} onChange={e => setConditionImmune(e.target.checked)} />Wybrany cel jest odporny na nakładany stan (potwierdza MG).</label>}{p.targets.flatMap(t => [...new Set((p.spec.components ?? [p.spec]).map(c => c.type))].filter(type => !t.defenseReady && !Object.hasOwn(t.defenses ?? {}, type ?? '')).map(type => ({ ...t, damageType: type }))).map(t => <div className="stack-form" key={`${t.id}:${t.damageType}`}><label>{b.fighters.find(f => f.id === t.id)?.name} {t.damageType}<select disabled={controller.pending} defaultValue="" onChange={e => { if (e.target.value !== '') void controller.mutate('act', { kind: 'spell-defense', targetId: t.id, damageType: t.damageType, conditionImmune, multiplier: Number(e.target.value) }); }}><option value="">Zatwierdź efekt obrażeń</option><option value="1">Zwykłe obrażenia</option><option value="0.5">Odporność — połowa</option><option value="0">Niewrażliwość — zero</option><option value="2">Podatność — podwójne</option></select></label></div>)}</details>;
}

export function ConcentrationForm({ controller, actor }: { controller: Controller; actor: Combatant }) {
  const [mindSliverRoll, setMindSliverRoll] = useState('');
  const [timedRolls, setTimedRolls] = useState<Record<string, number>>({});
  const [roll, setRoll] = useState('');
  const [roll2, setRoll2] = useState('');
  const [advantage, setAdvantage] = useState(false), [disadvantage, setDisadvantage] = useState(false);
  const [luck, setLuck] = useState('');
  const hexDis = hexDisadvantage(controller.response!.battle!, actor, 'con');
  return <form className="stack-form" onSubmit={e => { e.preventDefault(); void controller.mutate('act', { ...(luck ? { luckRoll: Number(luck) } : {}), kind: 'concentration', ...timedRolls, mindSliverRoll: Number(mindSliverRoll), actorId: actor.id, roll: Number(roll), roll2: Number(roll2), advantage, disadvantage }); }}><TimedRollInputs actor={actor} values={timedRolls} onChange={setTimedRolls} />{actor.spellConditions?.some(e => e.kind === 'mind-sliver') && <label>Mind Sliver: odejmij k4<input required type="number" min={1} max={4} value={mindSliverRoll} onChange={e => setMindSliverRoll(e.target.value)} /></label>}<label>{actor.name}: koncentracja, ST {actor.concentrationDC}. Podaj k20<input required type="number" min={1} max={20} value={roll} onChange={e => setRoll(e.target.value)} /></label><label className="battle-check"><input type="checkbox" checked={advantage} onChange={e => setAdvantage(e.target.checked)} />Ułatwienie wynikające ze zdolności lub efektu (uzgodnione z GM)</label><label className="battle-check"><input type="checkbox" checked={disadvantage} onChange={e => setDisadvantage(e.target.checked)} />Utrudnienie</label>{advantage !== (disadvantage || hexDis) && <label>Drugi k20<input required type="number" min={1} max={20} value={roll2} onChange={e => setRoll2(e.target.value)} /></label>}<LuckInput actor={actor} value={luck} onChange={setLuck} /><button className="primary-button" disabled={controller.pending}>Sprawdź koncentrację</button></form>;
}
