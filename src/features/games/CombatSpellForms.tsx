import { useState } from 'react';
import { barbarianSaveAdvantage, barbarianAttackAdvantage } from '../../../shared/barbarian.mjs';
import type { Combatant } from './battle-types';
import type { useBattle } from './LiveBattle';
type Controller = ReturnType<typeof useBattle>;

export function SpellCastForm({ controller, actor, slot }: { controller: Controller; actor: Combatant; slot: 'action' | 'bonus' | 'reaction' }) {
  const c = actor.spellcasting!;
  const spells = c.spells.filter(s => s.action === slot);
  const [spellId, setSpellId] = useState('');
  const [resource, setResource] = useState('');
  const [targetIds, setTargetIds] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const spell = spells.find(s => s.id === spellId);
  const b = controller.response!.battle!;
  const resources = spell?.level === 0 ? [{ key: 'cantrip:0', label: 'Sztuczka — bez miejsca na czar' }] : [
    ...c.slots.filter(s => s.remaining > 0 && s.level >= (spell?.level ?? 10)).map(s => ({ key: `${s.source}:${s.level}`, label: `${s.level}. krąg · ${s.remaining}/${s.total}${s.source === 'pact' ? ' · Pact Magic' : ''}` })),
    ...(spell?.arcanumRemaining ? [{ key: `arcanum:${spell.level}`, label: 'Mystic Arcanum — 1 użycie / długi odpoczynek' }] : []),
    ...(spell?.originFreeCast ? [{ key: `origin:${spell.level}`, label: 'Atut Origin — bez miejsca / długi odpoczynek' }] : []),
  ];
  const selectedResource = resources.find(r => r.key === resource)?.key ?? resources[0]?.key ?? '';
  const [source, level] = selectedResource.split(':');
  const slotUsed = (b.slotCasters ?? []).includes(actor.id) && spell?.level !== 0 && !['arcanum', 'origin'].includes(source);
  return <form className="stack-form" onSubmit={e => {
    e.preventDefault();
    void controller.mutate('act', { kind: 'cast', actorId: actor.id, slot, spellId, source, level: Number(level), targetIds });
  }}>
    <p>Miejsca na czary: {c.slots.map(s => `${s.level}. krąg: ${s.remaining}/${s.total}${s.source === 'pact' ? ' (Pact)' : ''}`).join(' · ') || 'Brak'}</p>
    {c.error && <p className="form-error" role="alert">{c.error}</p>}
    <label>Dostępny czar<select required value={spellId} onChange={e => { setSpellId(e.target.value); setResource(''); setTargetIds([]); setConfirmed(false); }}><option value="">Wybierz czar</option>{spells.map(s => <option key={s.id} value={s.id}>{s.name} · {s.level ? `${s.level}. krąg` : 'sztuczka'}{s.effect ? '' : ' · efekty rozstrzyga GM'}</option>)}</select></label>
    {spell && <>
      <label>Miejsce na czar / źródło<select required value={selectedResource} onChange={e => setResource(e.target.value)}>{!resources.length && <option value="">Brak dostępnego zasobu</option>}{resources.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}</select></label>
      <p>{spell.range} · {spell.duration}</p><p className="item-description">{spell.description}</p>{spell.upgrade && <p>{spell.upgrade}</p>}
      {!spell.effect && <p>Ten czar zużyje właściwy zasób, a jego efekty i rzuty rozstrzygnie GM. Nie ma jeszcze pełnej automatyzacji tego efektu.</p>}
      {slotUsed && <p role="status">W tej turze wykorzystano już miejsce na czar. Dostępna może być sztuczka lub źródło niewymagające miejsca.</p>}
      {spell.effect && spell.effect.mode !== 'shield' && <fieldset><legend>{spell.effect.area ? 'Cele w obszarze (uzgodnij z GM)' : 'Cel czaru'}</legend>{b.fighters.filter(f => f.hidden || f.deathFailures < 3).map(f => <label className="battle-check" key={f.id}><input type={spell.effect!.area ? 'checkbox' : 'radio'} name="spell-target" checked={targetIds.includes(f.id)} onChange={e => setTargetIds(spell.effect!.area ? e.target.checked ? [...targetIds, f.id] : targetIds.filter(id => id !== f.id) : [f.id])} />{f.name}</label>)}</fieldset>}
      <label className="battle-check"><input required type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />Potwierdzam z GM zasięg, widoczność, komponenty i ewentualny wyzwalacz reakcji.</label>
      <button className="primary-button" disabled={controller.pending || !selectedResource || slotUsed || Boolean(c.error) || (Boolean(spell.effect) && spell.effect?.mode !== 'shield' && !targetIds.length)}>Rzuć czar</button>
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
  if (p?.kind !== 'spell') return null;
  const caster = b.fighters.find(f => f.id === p.actorId)!;
  const canCast = controller.response!.controlledIds.includes(caster.id);
  const target = p.stage === 'save' ? p.targets.find(t => t.saved === undefined && controller.response!.controlledIds.includes(t.id)) : null;
  const automaticDisadvantage = p.stage === 'attack' && (Boolean(caster.mockery) || b.fighters.some(f => p.targets.some(t => t.id === f.id) && (f.dodge || f.attackDisadvantage)));
  const savingTarget = b.fighters.find(f => f.id === target?.id);
  const attackTarget = b.fighters.find(f => f.id === p.targets[0]?.id);
  const canReckless = p.stage === 'attack' && b.fighters[b.turn].id === caster.id && caster.rageProfile?.recklessAttack && !caster.attackRollMade;
  const automaticAdvantage = p.stage === 'save' ? Boolean(savingTarget && barbarianSaveAdvantage(savingTarget, p.spec.save)) : p.stage === 'attack' && barbarianAttackAdvantage(caster, attackTarget);
  const needsTwo = (advantage || automaticAdvantage) !== (disadvantage || automaticDisadvantage);
  if (p.stage === 'save' && !target) return <p role="status">{p.spellName}: oczekiwanie na rzuty obronne celów.</p>;
  if (p.stage !== 'save' && !canCast) return <p role="status">{p.spellName}: oczekiwanie na rzuty osoby rzucającej czar.</p>;
  const count = p.spec.dice * (p.critical ? 2 : 1);
  const defensesReady = p.spec.mode === 'heal' || p.targets.every(t => t.saved && !p.spec.half || t.defenseReady);
  return <form className="stack-form" onSubmit={e => {
    e.preventDefault();
    void controller.mutate('act', p.stage === 'effect' ? { kind: 'spell-effect', rolls: Array.from({ length: count }, (_, i) => Number(rolls[i])) }
      : { kind: p.stage === 'attack' ? 'spell-attack' : 'spell-save', reckless: Boolean(canReckless && reckless), targetId: target?.id, roll: Number(roll), roll2: Number(roll2), advantage, disadvantage });
  }}>
    <h2>{p.spellName}</h2>{automaticAdvantage && <p>{p.stage === 'attack' ? 'Reckless Attack: ułatwienie ataku przeciwko celowi.' : p.spec.save === 'dex' ? 'Danger Sense: ułatwienie rzutu obronnego na Zręczność.' : 'Szał: ułatwienie rzutu obronnego na Siłę.'}</p>}
    {canReckless && <label><input type="checkbox" checked={reckless} onChange={e => setReckless(e.target.checked)} />Reckless Attack — wybór przy pierwszym rzucie na atak. Ten czar nie używa Siły, ale ataki przeciwko tobie zyskają ułatwienie.</label>}
    {p.stage !== 'effect' ? <>
      <p>{p.stage === 'attack' ? 'Rzut na atak czarem' : `Rzut obronny (${p.spec.save?.toUpperCase()}): ${b.fighters.find(f => f.id === target?.id)?.name}`}</p>
      <label>k20 bez premii<input required type="number" min={1} max={20} value={roll} onChange={e => setRoll(e.target.value)} /></label>
      <label className="battle-check"><input type="checkbox" checked={advantage} onChange={e => setAdvantage(e.target.checked)} />Ułatwienie</label><label className="battle-check"><input type="checkbox" checked={disadvantage} onChange={e => setDisadvantage(e.target.checked)} />Utrudnienie</label>
      {automaticDisadvantage && <p>Atak wymaga utrudnienia.</p>}
      {needsTwo && <label>Drugi k20<input required type="number" min={1} max={20} value={roll2} onChange={e => setRoll2(e.target.value)} /></label>}
    </> : <><p>{p.spec.mode === 'heal' ? 'Leczenie' : 'Obrażenia'}: {count}k{p.spec.sides}{p.spec.bonus ? ` + ${p.spec.bonus}` : ''}{p.critical ? ' · krytyk' : ''}. Podaj same kości; serwer doda premię i zastosuje wynik rzutu obronnego.</p><div className="battle-fields">{Array.from({ length: count }, (_, i) => <label key={i}>Kość {i + 1}<input required type="number" min={1} max={p.spec.sides} value={rolls[i] ?? ''} onChange={e => setRolls(old => { const next = [...old]; next[i] = e.target.value; return next; })} /></label>)}</div></>}
    {p.stage === 'effect' && !defensesReady && <p role="status">Oczekiwanie na GM. W panelu „GM: odporności i podatności” prowadzący musi zatwierdzić efekt obrażeń dla: {p.targets.filter(t => !t.defenseReady && !(t.saved && !p.spec.half)).map(t => b.fighters.find(f => f.id === t.id)?.name).join(', ')}. Jeśli cel nie ma odporności ani podatności, GM wybiera „Zwykłe obrażenia”. Wpisane kości pozostaną zachowane.</p>}
    <button className="primary-button" disabled={controller.pending || p.stage === 'effect' && !defensesReady}>{p.stage === 'effect' && !defensesReady ? 'Oczekiwanie na zatwierdzenie GM' : 'Zatwierdź rzuty'}</button>
  </form>;
}

export function SpellDefenses({ controller }: { controller: Controller }) {
  const b = controller.response!.battle!, p = b.pending;
  if (p?.kind !== 'spell' || p.spec.mode === 'heal') return null;
  return <details open><summary>GM: odporności i podatności — {p.spec.type}</summary><p>Wybierz wynik zgodny ze statystykami i aktualnymi efektami celu. Odporność Szału na obrażenia obuchowe, kłute i cięte zostanie zastosowana automatycznie (bez podwójnego dzielenia). Aplikacja połączy wybór z rzutem obronnym i obliczy końcowe obrażenia.</p>{p.targets.filter(t => !t.defenseReady).map(t => <div className="stack-form" key={t.id}><label>{b.fighters.find(f => f.id === t.id)?.name}<select disabled={controller.pending} defaultValue="" onChange={e => { if (e.target.value !== '') void controller.mutate('act', { kind: 'spell-defense', targetId: t.id, multiplier: Number(e.target.value) }); }}><option value="">Zatwierdź efekt obrażeń</option><option value="1">Zwykłe obrażenia</option><option value="0.5">Odporność — połowa</option><option value="0">Niewrażliwość — zero</option><option value="2">Podatność — podwójne</option></select></label></div>)}</details>;
}

export function ConcentrationForm({ controller, actor }: { controller: Controller; actor: Combatant }) {
  const [roll, setRoll] = useState('');
  const [roll2, setRoll2] = useState('');
  const [advantage, setAdvantage] = useState(false), [disadvantage, setDisadvantage] = useState(false);
  return <form className="stack-form" onSubmit={e => { e.preventDefault(); void controller.mutate('act', { kind: 'concentration', actorId: actor.id, roll: Number(roll), roll2: Number(roll2), advantage, disadvantage }); }}><label>{actor.name}: koncentracja, ST {actor.concentrationDC}. Podaj k20<input required type="number" min={1} max={20} value={roll} onChange={e => setRoll(e.target.value)} /></label><label className="battle-check"><input type="checkbox" checked={advantage} onChange={e => setAdvantage(e.target.checked)} />Ułatwienie wynikające ze zdolności lub efektu (uzgodnione z GM)</label><label className="battle-check"><input type="checkbox" checked={disadvantage} onChange={e => setDisadvantage(e.target.checked)} />Utrudnienie</label>{advantage !== disadvantage && <label>Drugi k20<input required type="number" min={1} max={20} value={roll2} onChange={e => setRoll2(e.target.value)} /></label>}<button className="primary-button" disabled={controller.pending}>Sprawdź koncentrację</button></form>;
}
