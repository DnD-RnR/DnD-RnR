import { fighterIndomitable } from './fighter.mjs';
import { randomUUID } from 'node:crypto';
import { resourceState, saveResources } from './spell-resources.mjs';
import { endCondition, persistConditionState } from './conditions.mjs';
import { isIncapacitated, exhaustionPenalty, conditionSaveAdvantage, conditionSaveDisadvantage, automaticSaveFailure } from '../shared/conditions.mjs';
import { mindlessImmune, barbarianSaveAdvantage, brutalSaveDisadvantage, consumeBrutalSave, indomitableTotal, rageDamageTypes } from '../shared/barbarian.mjs';
import { speciesD20, speciesSaveAdvantage } from '../shared/species.mjs';
import { timedSaveModifier, timedRollModifier, timedSize } from '../shared/timed-effects.mjs';
import { spellSpeed, healingBlocked, consumeSavePenalty } from './spell-conditions.mjs';
import { hexDisadvantage } from '../shared/warlock.mjs';
import { luckBonus } from './warlock-features.mjs';

const check = (ok, message) => { if (!ok) throw new Error(message); };
const die = (n, sides) => Number.isInteger(n) && n >= 1 && n <= sides;
const turnKey = b => `${b.round}:${b.turn}`;
const untilNext = (b, f) => b.round + (b.fighters.indexOf(f) <= b.turn ? 1 : 0);
export function barbarianSaveTotal(db, b, f, ability, body, extra = 0, fixedModifier = null, capture = null, intervention = null) {
  if (automaticSaveFailure(f, ability)) { consumeBrutalSave(f); return -Infinity; }
  const adv = Boolean(body.advantage || barbarianSaveAdvantage(f, ability) || speciesSaveAdvantage(f, ability, body.condition) || conditionSaveAdvantage(f, ability));
  const dis = Boolean(body.disadvantage || brutalSaveDisadvantage(f) || conditionSaveDisadvantage(f, ability) || hexDisadvantage(b, f, ability));
  check(die(body.roll, 20) && (adv === dis || die(body.roll2, 20)) && f.saves[ability] != null, 'Podaj k20 i drugą kość przy ułatwieniu lub utrudnieniu.');
  const first = speciesD20(f, body.roll, body.halflingRoll), second = speciesD20(f, body.roll2, body.halflingRoll2);
  const roll = adv === dis ? first : adv ? Math.max(first, second) : Math.min(first, second);
  consumeBrutalSave(f);
  const modifier = fixedModifier ?? (f.saves[ability] - exhaustionPenalty(f) + timedSaveModifier(f, ability) + timedRollModifier(f, body) - consumeSavePenalty(f, body.mindSliverRoll) + (f.characterId ? luckBonus(db, f.characterId, body.luckRoll) : 0));
  if (capture) Object.assign(capture, { roll, modifier, advantage: adv, disadvantage: dis });
  const original = indomitableTotal(f, ability, roll + modifier + extra);
  return intervention ? fighterIndomitable(db, f, body, original, intervention.dc, modifier, adv, dis, message => intervention.log(b, message)) : original;
}
export function barbarianRageStarted(db, b, f, body, persistVitals) {
  if (f.rageProfile.berserker && f.level >= 6) {
    endCondition(db, f, 'charmed'); endCondition(db, f, 'frightened');
  }
  if (f.rageProfile.worldTree) { f.tempHp = Math.max(f.tempHp ?? 0, f.level); persistVitals(db, f); }
  if (f.rageProfile.wildHeart && f.level >= 14) {
    check(['falcon', 'lion', 'ram'].includes(body.power), 'Wybierz Falcon, Lion lub Ram przy aktywacji Szału.'); f.rage.power = body.power;
  }
  if (body.divineForm) {
    const state = resourceState(db, f.characterId);
    check(f.rageProfile.zealot && f.level >= 14 && !state.divineFormUsed, 'Rage of the Gods niedostępne.');
    state.divineFormUsed = true; f.divineForm = { endRound: b.round + 10, expiresAt: Date.now() + 60000 }; saveResources(db, f.characterId, state);
  }
  f.rage.id = randomUUID(); f.rage.fanaticalUsed = false;
}
export function syncBarbarianFeatures(db, b, persistVitals) {
  for (const f of b.fighters) {
    if (f.revivification && f.revivification.eventId !== b.pending?.revivificationId) f.revivification = null;
    f.brutalEffects = (f.brutalEffects ?? []).filter(e => {
      const source = b.fighters.find(s => s.id === e.sourceId);
      return source && (b.round < e.endRound || b.round === e.endRound && b.turn < b.fighters.indexOf(source));
    });
    if (f.branchHold && (b.round > f.branchHold.round || b.turn !== f.branchHold.turn)) f.branchHold = null;
    if (f.barbarianPresence) {
      const source = b.fighters.find(s => s.id === f.barbarianPresence.sourceId);
      if (!source || b.round > f.barbarianPresence.endRound || b.round === f.barbarianPresence.endRound && b.turn >= b.fighters.indexOf(source)) f.barbarianPresence = null;
    }
    if (f.divineForm && (f.hp === 0 && !f.relentlessRagePending || Date.now() >= f.divineForm.expiresAt || (b.round > f.divineForm.endRound || b.round === f.divineForm.endRound && b.turn >= b.fighters.indexOf(f)))) f.divineForm = null;
    if (f.characterId && f.rageProfile?.max) f.wearingAnyArmor = Boolean(db.prepare("SELECT 1 FROM character_items i JOIN armor_catalog a ON a.id = i.armor_id WHERE i.character_id = ? AND i.equipped = 1 AND a.category != 'shield'").get(f.characterId));
    if (f.rage && f.rageProfile?.berserker && f.level >= 6) for (const kind of ['charmed', 'frightened']) {
      if ((f.conditionSources ?? []).some(e => e.kind === kind) || (f.manualConditions ?? []).includes(kind) || (f.timedEffects ?? []).some(e => e.modifiers.condition === kind) || (f.spellConditions ?? []).some(e => e.kind === kind)) endCondition(db, f, kind);
    }
    if (f.treeGift) {
      const source = b.fighters.find(s => s.id === f.treeGift.sourceId);
      if (f.tempHp > f.treeGift.maximum) f.treeGift = null;
      else if (!source?.rage || source.rage.id !== f.treeGift.rageId) { f.tempHp = 0; f.treeGift = null; persistVitals(db, f); }
    }
    for (const fear of f.barbarianFears ?? []) if (b.round > fear.endRound || b.round === fear.endRound && b.turn >= b.fighters.findIndex(s => s.id === fear.sourceId) || fear.expiresAt <= Date.now() || mindlessImmune(f, 'frightened')) {
      f.conditionSources = (f.conditionSources ?? []).filter(e => e.id !== fear.id); persistConditionState(db, f);
    }
    f.barbarianFears = (f.barbarianFears ?? []).filter(e => (f.conditionSources ?? []).some(s => s.id === e.id));
  }
}
export function barbarianHit({ db, b, actor, target, p, body, damage, persistVitals, log }) {
  const extraDice = (count, sides, values, message) => { check(Array.isArray(values) && values.length === count && values.every(n => die(n, sides)), message); return values.reduce((a, n) => a + n, 0); };
  if (p.brutal) {
    const choices = body.brutalEffects ?? [];
    const allowed = ['forceful', 'hamstring', ...(actor.level >= 13 ? ['staggering', 'sundering'] : [])];
    check(Array.isArray(choices) && choices.length <= actor.rageProfile.brutalEffects && new Set(choices).size === choices.length && choices.every(e => allowed.includes(e)), 'Wybierz dostępne, różne efekty Brutal Strike.');
    const amount = extraDice(actor.rageProfile.brutalDice * (p.critical ? 2 : 1), 10, body.brutalRolls, 'Podaj kości k10 Brutal Strike.');
    damage(db, target, amount, false, p.attack.type, Boolean(actor.epicOffense && rageDamageTypes.includes(p.attack.type?.toLowerCase())));
    for (const choice of choices) {
      const add = kind => { target.brutalEffects ??= []; target.brutalEffects = target.brutalEffects.filter(e => e.kind !== kind); target.brutalEffects.push({ kind, sourceId: actor.id, endRound: untilNext(b, actor) }); };
      if (choice === 'forceful') {
        check(body.confirmed === true && Number.isInteger(body.brutalFeet ?? 0) && (body.brutalFeet ?? 0) >= 0 && (body.brutalFeet ?? 0) <= Math.floor(spellSpeed(actor) / 2), 'MG potwierdza odepchnięcie 15 stóp i ruch do połowy szybkości wprost do celu.');
        log(b, `${actor.name}: Forceful Blow — cel odepchnięty 15 stóp; ruch ${body.brutalFeet ?? 0} stóp bez ataków okazyjnych.`);
      }
      if (choice === 'hamstring') add('hamstring');
      if (choice === 'staggering') { add('stagger-save'); add('no-opportunity'); }
      if (choice === 'sundering') add('sundering');
    }
  }
  if (p.divineFury) {
    check(['nekrotyczne', 'promieniste'].includes(body.divineType), 'Wybierz Necrotic albo Radiant dla Divine Fury.');
    const amount = extraDice(p.critical ? 2 : 1, 6, body.divineRolls, 'Podaj k6 Divine Fury.') + Math.floor(actor.level / 2);
    damage(db, target, amount, false, body.divineType);
  }
  if (actor.rage?.power === 'ram' && p.attack.melee && body.ram) {
    check(['Tiny', 'Small', 'Medium', 'Large'].includes(timedSize(target)), 'Ram wymaga celu Large lub mniejszego.'); target.prone = true; persistConditionState(db, target);
  }
  if (actor.rageProfile?.worldTree && actor.level >= 10 && p.attack.roots && body.roots) {
    check(b.fighters[b.turn].id === actor.id && ['push', 'topple'].includes(body.roots) && body.confirmed === true, 'Battering Roots wymaga trafienia odpowiednią bronią we własnej turze i potwierdzenia MG.');
    if (body.roots === 'topple') {
      check(target.saves.con != null, 'Uzupełnij CON celu.');
      if (barbarianSaveTotal(db, b, target, 'con', body.rootSave ?? {}) < 8 + actor.proficiency + actor.attackAbilityModifiers[p.attack.ability]) { target.prone = true; persistConditionState(db, target); }
    } else { check(['Tiny', 'Small', 'Medium', 'Large'].includes(timedSize(target)), 'Push: cel najwyżej Large.'); log(b, `${target.name}: Battering Roots — Push do 10 stóp.`); }
  }
}
export function applyBarbarianSaveEffect(db, b, source, target, p) {
  if (p.spec.barbarianFeature === 'presence') {
    if (mindlessImmune(target, 'frightened')) return;
    const id = randomUUID(); target.conditionSources ??= []; target.conditionSources.push({ id, kind: 'frightened', sourceId: source.id, sourceCharacterId: source.characterId, sourceName: 'Intimidating Presence' });
    target.barbarianFears ??= []; target.barbarianFears.push({ id, sourceId: source.id, dc: p.dc, endRound: b.round + 10, expiresAt: Date.now() + 60000, lastSave: null }); persistConditionState(db, target);
  } else if (p.spec.barbarianFeature === 'branches') {
    target.branchHold = p.spec.hold ? { round: b.round, turn: b.turn } : null;
  }
}
export function handleBarbarianFeatures({ db, b, body, gm, canControl, activeMember, persistVitals, damage, log }) {
  if (!body.kind?.startsWith('barb-')) return false;
  const f = b.fighters.find(t => t.id === (body.actorId ?? b.fighters[b.turn].id));
  const geometry = ['barb-lion-targets', 'barb-wolf-targets'].includes(body.kind);
  check(f && (!f.characterId || activeMember(db, b.sessionId, f)) && (canControl(f) || gm && geometry), 'Nie możesz sterować tą postacią.');
  check(!b.fighters.some(t => t.concentrationDC || t.relentlessRagePending), 'Najpierw rozstrzygnij oczekujące rzuty.');
  const own = () => check(f.id === b.fighters[b.turn].id && !b.pending, 'Wymagana własna tura bez rozpoczętego działania.');
  const confirm = () => check(body.confirmed === true, 'MG musi potwierdzić zasięg, widoczność i warunki zdolności.');
  const slot = key => { check(!f[key] && !(key === 'reaction' && f.reactionDeferred), 'Działanie zostało wykorzystane.'); f[key] = body.kind; };
  const targets = max => {
    check(Array.isArray(body.targetIds) && body.targetIds.length <= max && new Set(body.targetIds).size === body.targetIds.length, 'Wybierz poprawną liczbę różnych celów.');
    return body.targetIds.map(id => { const t = b.fighters.find(t => t.id === id); check(t && t.deathFailures < 3, 'Niepoprawny cel.'); return t; });
  };
  if (body.kind === 'barb-fear-save') {
    own(); const fear = f.barbarianFears?.find(e => e.id === body.effectId);
    check(fear && fear.lastSave !== turnKey(b), 'Brak powtórnego rzutu na tę turę.');
    fear.lastSave = turnKey(b); if (barbarianSaveTotal(db, b, f, 'wis', { ...body, condition: 'frightened' }) >= fear.dc) { f.conditionSources = f.conditionSources.filter(e => e.id !== fear.id); f.barbarianFears = f.barbarianFears.filter(e => e !== fear); persistConditionState(db, f); }
    f.spellTurnEnded = b.round; return true;
  }
  if (body.kind === 'barb-fanatical') {
    const p = b.pending, t = p?.targets?.find(t => t.id === f.id);
    check(p?.fanaticalTargetId === f.id && t && f.rage && !f.rage.fanaticalUsed, 'Fanatical Focus nie oczekuje na decyzję.');
    if (!body.decline) { f.rage.fanaticalUsed = true; t.saved = barbarianSaveTotal(db, b, f, p.spec.save, { ...body, advantage: t.rerollAdvantage, disadvantage: t.rerollDisadvantage }, f.rageProfile.damage, t.rerollModifier) >= p.dc; }
    delete p.fanaticalTargetId;
    if (p.targets.every(t => t.saved !== undefined)) { if (p.targets.every(t => t.saved) && !p.spec.half && !p.spec.successRider) b.pending = null; else p.stage = 'effect'; }
    return true;
  }
  if (body.kind === 'barb-fanatical-check') {
    const last = f.lastSavingThrow;
    check(f.rageProfile?.zealot && f.level >= 6 && f.rage && !f.rage.fanaticalUsed && last && last.round === b.round && last.turn === b.turn && body.confirmed === true && Number.isInteger(body.dc) && body.dc >= 1 && body.dc <= 100 && last.total < body.dc, 'Fanatical Focus wymaga potwierdzonego nieudanego rzutu obronnego.');
    f.rage.fanaticalUsed = true;
    const total = barbarianSaveTotal(db, b, f, last.ability, { ...body, advantage: last.advantage, disadvantage: last.disadvantage }, f.rageProfile.damage, last.modifier);
    f.lastSavingThrow = { ...last, total }; b.lastRoll = { kind: 'saving-throw', actorId: f.id, total, dc: body.dc };
    log(b, `${f.name}: Fanatical Focus ${total}, ST ${body.dc}: ${total >= body.dc ? 'sukces' : 'porażka'}.`); return true;
  }
  check(f.rageProfile?.max && f.hp > 0 && !isIncapacitated(f), 'Barbarzyńca nie może teraz działać.');
  const state = resourceState(db, f.characterId), profile = f.rageProfile;
  const spendRage = () => { check(f.rageUses > 0, 'Brak użyć Szału.'); f.rageUses--; state.rageUses = f.rageUses; };
  if (geometry) {
    check(gm && f.rage?.[body.kind === 'barb-lion-targets' ? 'power' : 'animal'] === (body.kind === 'barb-lion-targets' ? 'lion' : 'wolf') && !b.pending, 'Zasięg tej aury ustala MG.'); confirm();
    f.rage[body.kind === 'barb-lion-targets' ? 'lionTargets' : 'wolfTargets'] = targets(50).map(t => t.id);
  } else if (body.kind === 'barb-life-gift') {
    own(); confirm(); check(profile.worldTree && f.rage && f.lifeGiftTurn !== turnKey(b) && !f.action && !f.bonus && !f.moved, 'Life-Giving Force jest dostępne na początku tury w Szale.');
    const target = b.fighters.find(t => t.id === body.targetId);
    check(target && target.id !== f.id && Array.isArray(body.rolls) && body.rolls.length === profile.damage && body.rolls.every(n => die(n, 6)), 'Wybierz inną istotę i podaj kości k6.');
    const amount = body.rolls.reduce((a, n) => a + n, 0); f.lifeGiftTurn = turnKey(b);
    if (amount > (target.tempHp ?? 0)) { target.tempHp = amount; target.treeGift = { sourceId: f.id, rageId: f.rage.id, maximum: amount }; persistVitals(db, target); }
  } else if (body.kind === 'barb-branches') {
    confirm(); const target = b.fighters[b.turn];
    check(profile.worldTree && f.level >= 6 && f.rage && !b.pending && !target.action && !target.bonus && !target.moved && f.branchesTurn !== turnKey(b), 'Branches of the Tree wymaga początku tury widzianego celu w 30 stopach.');
    slot('reaction'); f.branchesTurn = turnKey(b);
    b.pending = { kind: 'spell', actorId: f.id, spellId: 'barbarian-branches', spellName: 'Branches of the Tree', stage: 'save', dc: 8 + f.strengthModifier + f.proficiency, spec: { mode: 'condition', barbarianFeature: 'branches', hold: body.hold === true, save: 'str', dice: 0, sides: 0, bonus: 0, type: 'Force' }, targets: [{ id: target.id }] };
    log(b, `${f.name}: przy porażce STR cel teleportuje się na widziane wolne pole do 5 stóp od barbarzyńcy (lub najbliższe wolne).`);
  } else if (body.kind === 'barb-travel') {
    own(); confirm(); check(profile.worldTree && f.level >= 14 && f.rage, 'Travel along the Tree niedostępne.');
    check(!body.extended || !f.rage.travelUsed, 'Teleportacja 150 stóp jest dostępna raz na Szał.');
    const passengers = targets(body.extended ? 6 : 0); check(passengers.every(t => t.id !== f.id), 'Pasażerowie muszą być inni niż barbarzyńca.');
    const activation = f.rage.activationTurn === turnKey(b) && !f.rage.activationTravelUsed && !f.action && !f.moved;
    if (activation) f.rage.activationTravelUsed = true; else slot('bonus');
    if (body.extended) f.rage.travelUsed = true;
    log(b, `${f.name}: teleportacja do ${body.extended ? 150 : 60} stóp; pasażerowie: ${passengers.length}.`);
  } else if (body.kind === 'barb-heal') {
    own(); check(profile.zealot && !healingBlocked(f), 'Warrior of the Gods niedostępne.');
    const max = f.level >= 17 ? 7 : f.level >= 12 ? 6 : f.level >= 6 ? 5 : 4;
    check(Array.isArray(body.rolls) && body.rolls.length > 0 && body.rolls.length <= max - (state.zealotDiceSpent ?? 0) && body.rolls.every(n => die(n, 12)), 'Podaj dostępne kości k12 leczenia.');
    slot('bonus'); state.zealotDiceSpent = (state.zealotDiceSpent ?? 0) + body.rolls.length; f.zealotDiceSpent = state.zealotDiceSpent;
    f.hp = Math.min(f.maxHp, f.hp + body.rolls.reduce((a, n) => a + n, 0)); persistVitals(db, f);
  } else if (['barb-intimidating', 'barb-zealous'].includes(body.kind)) {
    own(); confirm(); const presence = body.kind === 'barb-intimidating';
    check(presence ? profile.berserker && f.level >= 14 : profile.zealot && f.level >= 10, 'Ta zdolność nie jest dostępna.');
    const key = presence ? 'intimidatingUsed' : 'zealousUsed';
    if (state[key]) { check(body.restore === true, 'Zdolność jest zużyta; wydaj użycie Szału, aby ją odnowić.'); spendRage(); }
    slot('bonus'); state[key] = true;
    const selected = targets(presence ? 50 : 10); check(selected.every(t => t.id !== f.id), 'Wybierz inne istoty.');
    if (presence) b.pending = selected.length ? { kind: 'spell', actorId: f.id, spellId: 'barbarian-presence', spellName: 'Intimidating Presence', stage: 'save', dc: 8 + f.strengthModifier + f.proficiency, spec: { mode: 'condition', save: 'wis', rider: 'frightened', barbarianFeature: 'presence', dice: 0, sides: 0, bonus: 0, type: 'Psychic' }, targets: selected.map(t => ({ id: t.id })) } : null;
    else for (const target of selected) target.barbarianPresence = { sourceId: f.id, endRound: untilNext(b, f) };
  } else if (body.kind === 'barb-revivification') {
    confirm(); const p = b.pending, target = b.fighters.find(t => t.id === body.targetId);
    check(profile.zealot && f.divineForm && target && target.hp > 0 && target.deathFailures < 3 && (p?.kind === 'damage' && p.targetId === target.id || p?.kind === 'spell' && p.stage === 'effect' && p.targets.some(t => t.id === target.id)), 'Revivification wymaga formy boskiej i celu oczekujących obrażeń w 30 stopach.');
    slot('reaction'); spendRage(); p.revivificationId ??= randomUUID(); target.revivification = { sourceId: f.id, hp: f.level, eventId: p.revivificationId };
  } else throw new Error('Nieznana zdolność barbarzyńcy.');
  saveResources(db, f.characterId, state); log(b, `${f.name}: ${body.kind}.`); return true;
}
