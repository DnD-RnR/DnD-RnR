import { luckBonus, reflectThoughtShield } from './warlock-features.mjs';
import { warlockProfile, warlockResistance, bondAdvantage, hexDisadvantage, hexActive, damageTypeName } from '../shared/warlock.mjs';
import { moonSpells } from '../shared/druid.mjs';
import { spendSpell, resourceState, saveResources } from './spell-resources.mjs';
import { barbarianResistance, barbarianSaveAdvantage, barbarianAttackAdvantage, wolfAttackAdvantage } from '../shared/barbarian.mjs';
import { recordAttackRoll } from './barbarian.mjs';
import { vowAttackAdvantage } from './paladin.mjs';
import { consumeSavePenalty, enfeeblementReduction, addSpellCondition, consumeSpellAttack, hasSpellCondition, healingBlocked, spellDisadvantage } from './spell-conditions.mjs';
import { timedAc, timedResistance, timedRollModifier, timedSpellDefinitions } from '../shared/timed-effects.mjs';
import { applyTimedEffect, dismissTimedEffect } from './timed-effects.mjs';
import { endConcentration, startConcentration } from './concentration.mjs';
import { randomUUID } from 'node:crypto';
import { strongestEffects } from '../shared/timed-effects.mjs';
import { automaticSaveFailure, conditionAttackModifiers, conditionSaveDisadvantage, hasCondition, isIncapacitated } from '../shared/conditions.mjs';
import { endCondition, endTimedCondition } from './conditions.mjs';
import { spellDamageDice, spellDamageParts, defendSpellDamage } from '../shared/spell-damage.mjs';
import { beginDelayedSpellDamage, scheduleSpellDamage } from './delayed-spells.mjs';
import { beginZoneDamage, createSpellZone, syncSpellZones } from './spell-zones.mjs';

const check = (condition, message) => { if (!condition) throw new Error(message); };
const die = (n, sides = 20) => Number.isInteger(n) && n >= 1 && n <= sides;
const d20 = (body, forcedDisadvantage = false) => {
  const advantage = Boolean(body.advantage), disadvantage = Boolean(body.disadvantage || forcedDisadvantage);
  check(die(body.roll) && (advantage === disadvantage || die(body.roll2)), 'Podaj wynik k20 i drugą kość przy ułatwieniu/utrudnieniu.');
  return advantage === disadvantage ? body.roll : advantage ? Math.max(body.roll, body.roll2) : Math.min(body.roll, body.roll2);
};
function advanceProjectile(b, p) {
  let next;
  while ((next = p.remainingTargets?.shift())) {
    if (!b.fighters.some(f => f.id === next && f.deathFailures < 3 && (f.characterId || f.hp > 0))) continue;
    p.targets = [{ id: next }]; p.stage = 'attack'; p.critical = false; p.hexDice = 0; p.attackTotal = null;
    return;
  }
  b.pending = null;
}
export function handleCombatSpell({ db, user, gm, b, body, canControl, activeMember, damage, persistVitals, log }) {
  if (!['cast', 'spell-attack', 'spell-save', 'spell-effect', 'spell-defense', 'concentration', 'condition-save', 'end-concentration', 'dismiss-effect', 'delayed-spell'].includes(body.kind)) return false;
  const controlled = f => f && activeMember(db, b.sessionId, f) && canControl(f);
  const caster = b.fighters.find(f => f.id === (body.actorId ?? b.fighters[b.turn]?.id));
  if (body.kind === 'delayed-spell') {
    check(caster?.id === b.fighters[b.turn].id && (gm || controlled(caster)), 'To nie jest twoja tura.');
    check(!b.fighters.some(f => f.concentrationDC), 'Najpierw rozstrzygnij rzuty koncentracji.');
    check(typeof body.effectId === 'string' && beginDelayedSpellDamage(b, caster, body.effectId), 'Brak obrażeń do rozliczenia na koniec tej tury.');
    return true;
  }
  if (body.kind === 'end-concentration') {
    check(controlled(caster) && caster.concentration, 'Nie możesz zakończyć tej koncentracji.');
    endConcentration(db, caster); log(b, `${caster.name}: koniec koncentracji (bez akcji).`); return true;
  }
  if (body.kind === 'dismiss-effect') {
    check(controlled(caster) && !isIncapacitated(caster) && typeof body.castingId === 'string', 'Nie możesz zakończyć tego czaru.');
    check(dismissTimedEffect(db, b, caster, body.castingId) !== false, 'Skutek czaru natychmiastowego kończy się zgodnie z jego opisem; nie można go odwołać.'); log(b, `${caster.name}: zakończenie czaru (bez akcji).`); return true;
  }
  if (body.kind === 'condition-save') {
    check(!b.pending && controlled(caster) && caster.id === b.fighters[b.turn].id, 'Powtórz rzut na koniec własnej tury, po rozstrzygnięciu działań.');
    const timed = strongestEffects(caster.timedEffects).find(e => e.modifiers.repeatSave && e.lastSaveRound !== b.round && (body.effectId ? e.id === body.effectId : e.sourceFighterId === body.sourceId && e.modifiers.condition === body.condition));
    const effect = timed ?? caster.spellConditions?.find(e => e.sourceId === body.sourceId && e.kind === body.condition && e.concentrationKey && e.lastSaveRound !== b.round);
    const save = timed ? timed.modifiers.repeatSave : effect?.save;
    check(effect && caster.saves[save] != null, 'Brak powtórnego rzutu obronnego.');
    const roll = d20({ ...body, disadvantage: body.disadvantage || conditionSaveDisadvantage(caster, save) || hexDisadvantage(b, caster, save), advantage: body.advantage || barbarianSaveAdvantage(caster, save) });
    const success = !automaticSaveFailure(caster, save) && roll + caster.saves[save] + timedRollModifier(caster, body) - consumeSavePenalty(caster, body.mindSliverRoll) >= effect.dc;
    caster.spellTurnEnded = b.round;
    effect.lastSaveRound = b.round;
    if (timed) {
      if (success) endTimedCondition(db, caster, timed.id);
      else if (caster.characterId) { const state = resourceState(db, caster.characterId); const persisted = state.activeEffects?.find(e => e.id === timed.id); if (persisted) persisted.lastSaveRound = b.round; saveResources(db, caster.characterId, state); }
    } else if (success) caster.spellConditions = caster.spellConditions.filter(e => e !== effect);
    log(b, `${caster.name}: powtórny rzut przeciw ${timed?.name ?? effect.kind} — ${success ? 'koniec efektu' : 'efekt trwa'}.`);
    return true;
  }
  if (body.kind === 'cast') {
    check(caster && !caster.rage && !isIncapacitated(caster), 'Wild Shape, Szał lub stan postaci uniemożliwia rzucanie czarów.');
    check(controlled(caster) && caster.characterId && caster.hp > 0 && caster.deathFailures < 3, 'Nie możesz rzucić czaru tą postacią.');
    if (caster.wildShape) {
      const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(caster.characterId);
      check(moonSpells(character).includes(body.spellId), 'W Wild Shape możesz rzucać tylko czary Kręgu Księżyca.');
    }
    if (b.pending) {
      check(body.slot === 'reaction' && !b.suspendedAction, 'Najpierw rozstrzygnij rozpoczęte działanie.');
      b.suspendedAction = b.pending; b.pending = null;
    }
    check(caster.id === b.fighters[b.turn].id || body.slot === 'reaction', 'Poza własną turą dostępne są tylko reakcje.');
    check(!caster[body.slot] && ['action', 'bonus', 'reaction'].includes(body.slot), 'Działanie zostało już wykorzystane.');
    check(!b.fighters.some(f => f.concentrationDC), 'Najpierw rozstrzygnij rzuty koncentracji.');
    const c = spendSpell(db, caster.characterId, body.spellId, body.level, body.source);
    check(c.spell.action === body.slot, 'Czas rzucania czaru nie pasuje do tego kroku tury.');
    check(!c.blocked, 'Brak wyszkolenia w założonym pancerzu blokuje rzucanie czarów.');
    const spentSlot = c.spell.level > 0 && !['arcanum', 'origin', 'paladin-smite', 'legacy'].includes(body.source);
    check(!spentSlot || !(b.slotCasters ?? []).includes(caster.id), 'W tej turze wykorzystano już miejsce na czar.');
    if (spentSlot) b.slotCasters = [...(b.slotCasters ?? []), caster.id];
    caster[body.slot] = `Czar: ${c.spell.name}`;
    if (c.spell.duration?.includes('Koncentracja')) {
      startConcentration(db, caster, c.spell, b);
    }
    log(b, `${caster.name}: ${c.spell.name}${c.spell.level ? ` (${body.level}. krąg, ${body.source === 'paladin-smite' ? 'Paladin Smite' : body.source === 'arcanum' ? 'Mystic Arcanum' : body.source === 'legacy' ? 'Fiendish Legacy — bez miejsca' : body.source === 'origin' ? 'atut Origin' : 'zużyto miejsce'})` : ' (sztuczka)'}.`);
    const wp = warlockProfile(c.character, c.stats.values.cha, c.state);
    check(!body.psychic || wp.greatOldOne && (c.spell.classes.includes('warlock') || c.profile.automatic.some(s => s.id === c.spell.id && ['Great Old One Patron', 'Eldritch Hex', 'Contact Patron'].includes(s.reason))), 'Psychic Spells wymaga czaru Warlocka i Great Old One.');
    if (c.spell.id === 'hex') {
      const target = b.fighters.find(f => f.id === body.targetIds?.[0]);
      check(target && body.targetIds.length === 1 && ['str', 'dex', 'con', 'int', 'wis', 'cha'].includes(body.hexAbility), 'Hex: wybierz jeden cel i cechę.');
      caster.hex = { damageType: body.psychic ? 'psychiczne' : 'nekrotyczne', targetId: target.id, targetDefeated: target.hp === 0, defeatedRound: target.hp === 0 ? b.round : null, ability: body.hexAbility, eldritch: wp.eldritchHex, name: c.spell.name, expiresAt: Date.now() + (body.level >= 5 ? 24 : body.level >= 3 ? 8 : 1) * 3600000 };
      const state = resourceState(db, caster.characterId); state.hex = caster.hex; saveResources(db, caster.characterId, state);
      log(b, `${caster.name}: Hex → ${target.name}, ${body.hexAbility.toUpperCase()}${wp.eldritchHex ? ' — również rzuty obronne' : ''}.`);
      return true;
    }
    if (!c.spell.effect) {
      b.pending = { kind: 'request', actorId: caster.id, slot: body.slot, description: `${c.spell.name}${body.psychic ? ' (Psychic Spells: obrażenia psychiczne)' : ''} — ${c.spell.description ?? ''}\n${c.spell.upgrade ?? ''}\nZasięg i komponenty oraz efekty specjalne rozstrzyga GM. Zasób został już zużyty.` };
      return true;
    }
    const spec = { ...c.spell.effect };
    if (spec.components) spec.components = spec.components.map(part => ({ ...part, dice: part.dice + (body.level - c.spell.level) * (part.perLevel ?? 0), type: body.psychic ? 'Psychic' : part.type }));
    if (spec.conditionOptions) check(spec.conditionOptions.includes(body.conditionChoice), 'Wybierz stan obsługiwany przez ten czar.');
    if (body.psychic && spec.type) spec.type = 'Psychic';
    if (spec.mode === 'shield') {
      if (!caster.shieldAC) { caster.ac += 5; caster.shieldAC = 5; }
      log(b, `${caster.name}: Shield — osłona do początku następnej własnej tury.`);
      return true;
    }
    const targets = spec.self ? [caster] : Array.isArray(body.targetIds) ? body.targetIds.map(id => b.fighters.find(f => f.id === id)) : [];
    const projectiles = spec.cantripBeams ? c.character.level >= 17 ? 4 : c.character.level >= 11 ? 3 : c.character.level >= 5 ? 2 : 1 : spec.projectiles ? spec.projectiles + (body.level - c.spell.level) * (spec.projectilesPerLevel ?? 0) : 0;
    const maxTargets = spec.maxTargets ? spec.maxTargets + (body.level - c.spell.level) * (spec.targetsPerLevel ?? 0) : spec.extraTargets ? body.level - 1 : spec.area ? 50 : 1;
    check(projectiles ? targets.length === projectiles && targets.every(Boolean) : (targets.length > 0 || spec.zone) && targets.length <= maxTargets && targets.every(Boolean) && new Set(targets.map(t => t.id)).size === targets.length, 'Wybierz właściwe cele czaru i cel dla każdego promienia.');
    if (spec.humanoid) check(targets.every(t => t.creatureType === 'Humanoid' || !t.creatureType && body.confirmedHumanoid === true), 'Hold Person: cel musi być Humanoidem; nieznany typ potwierdza GM.');
    check(targets.every(t => t.deathFailures < 3), 'Zwykły czar nie przywraca życia martwemu celowi.');
    if (spec.mode === 'restore-condition') {
      for (const target of targets) endCondition(db, target, body.conditionChoice);
      log(b, `${c.spell.name}: zakończono ${body.conditionChoice} na ${targets.map(t => t.name).join(', ')}.`); return true;
    }
    if (spec.repeatSave) check(c.dc != null && targets.every(t => t.saves[spec.repeatSave] != null), 'Uzupełnij ST czaru i powtórny rzut obronny celu.');
    if (timedSpellDefinitions[c.spell.id]?.mageArmor) check(targets.every(t => !t.wearingArmor && t.dexModifier != null), 'Mage Armor wymaga celu bez pancerza i znanego modyfikatora DEX.');
    if (spec.mode === 'timed') {
      const castingId = randomUUID();
      for (const target of targets) applyTimedEffect(db, b, caster, target, c.spell, body.level, castingId);
      log(b, `${c.spell.name}: aktywny efekt na ${targets.map(t => t.name).join(', ')}.`); return true;
    }
    spec.dice += spec.cantrip ? (c.character.level >= 17 ? 3 : c.character.level >= 11 ? 2 : c.character.level >= 5 ? 1 : 0) : (body.level - c.spell.level) * (spec.perLevel ?? 0);
    if (spec.woundedSides && targets[0].hp < targets[0].maxHp) spec.sides = spec.woundedSides;
    spec.bonus = spec.ability ? c.ability : (spec.flatBonus ?? 0) + (body.level - c.spell.level) * (spec.bonusPerLevel ?? 0);
    if (c.spell.level === 0 && c.stats.traits?.invocations?.includes(`agonizing-blast:${c.spell.id}`)) {
      const cha = c.stats.values.cha;
      check(cha != null, 'Agonizing Blast: uzupełnij Charyzmę.');
      spec.bonus += Math.floor((cha - 10) / 2);
    }
    spec.repelling = c.stats.traits?.invocations?.includes(`repelling-blast:${c.spell.id}`) === true;
    check(spec.bonus !== null && (spec.mode !== 'attack' || c.attack !== null) && (spec.mode !== 'save' || c.dc !== null), 'Uzupełnij cechę czarowania postaci.');
    if (['save', 'condition', 'timed-save'].includes(spec.mode)) check(c.dc !== null && targets.every(t => automaticSaveFailure(t, spec.save) || t.saves?.[spec.save] != null), 'Uzupełnij ST czaru i modyfikator rzutu obronnego celów.');
    if (spec.zone) {
      syncSpellZones(db, b);
      const zone = createSpellZone(db, b, caster, c.spell, body.level, spec, c.dc, targets.map(t => t.id));
      beginZoneDamage(b, zone, targets.map(t => t.id));
      log(b, `${c.spell.name}: aktywna strefa. ${spec.gmNote}`);
      return true;
    }
    b.pending = { kind: 'spell', actorId: caster.id, conditionChoice: body.conditionChoice, spellName: c.spell.name, spellId: c.spell.id, spellLevel: c.spell.level, castingLevel: body.level, castingId: randomUUID(), stage: spec.mode === 'attack' ? 'attack' : ['save', 'condition', 'timed-save'].includes(spec.mode) ? 'save' : 'effect', spec,
      concentrationKey: caster.concentrationKey, attackBonus: c.attack, dc: c.dc, targets: (projectiles ? targets.slice(0, 1) : targets).map(t => ({ id: t.id })), remainingTargets: projectiles ? targets.slice(1).map(t => t.id) : [] };
    return true;
  }
  if (body.kind === 'concentration') {
    check(controlled(caster) && caster.hp > 0 && caster.concentrationDC, 'Brak testu koncentracji do wykonania.');
    const roll = d20({ ...body, disadvantage: body.disadvantage || hexDisadvantage(b, caster, 'con') }), bonus = caster.saves.con;
    check(bonus != null, 'Uzupełnij rzut obronny na Kondycję.');
    const success = roll + bonus + timedRollModifier(caster, body) + luckBonus(db, caster.characterId, body.luckRoll) - consumeSavePenalty(caster, body.mindSliverRoll) >= caster.concentrationDC;
    log(b, `${caster.name}: koncentracja — ${success ? 'utrzymana' : 'przerwana'}.`);
    if (!success) endConcentration(db, caster);
    else caster.concentrationChecks = (caster.concentrationChecks ?? [caster.concentrationDC]).slice(1);
    caster.concentrationDC = caster.concentrationChecks[0] ?? null;
    const state = resourceState(db, caster.characterId); state.concentration = caster.concentration; saveResources(db, caster.characterId, state);
    return true;
  }
  const p = b.pending;
  check(p?.kind === 'spell', 'Brak czaru do rozstrzygnięcia.');
  const resolver = b.fighters.find(f => f.id === p.actorId);
  const actor = p.delayedDamageId || p.zoneEvent ? b.fighters.find(f => f.id === p.sourceId) ?? { id: p.sourceId, spellConditions: [] } : resolver;
  if (body.kind === 'spell-defense') {
    check(gm && !['heal', 'temp-hp'].includes(p.spec.mode), 'Odporności i podatności zatwierdza GM.');
    const target = p.targets.find(t => t.id === body.targetId);
    check(target && [0, 0.5, 1, 2].includes(body.multiplier), 'Wybierz cel i modyfikator obrażeń.');
    const fighter = b.fighters.find(f => f.id === target.id);
    const types = [...new Set((p.spec.components ?? [p.spec]).map(c => c.type))];
    const type = p.spec.components ? body.damageType : p.spec.type;
    check(types.includes(type), 'Wybierz typ obrażeń tego czaru.');
    const resistance = hasCondition(fighter, 'petrified') || timedResistance(fighter, damageTypeName(type)) || barbarianResistance(fighter, type) || warlockResistance(fighter, type) || fighter.damageResistance === damageTypeName(type);
    target.defenses ??= {};
    target.defenses[type] = { immune: body.multiplier === 0, resistant: Boolean(resistance || body.multiplier === 0.5), vulnerable: body.multiplier === 2 };
    target.multiplier = resistance && body.multiplier !== 0.5 ? body.multiplier * 0.5 : body.multiplier;
    target.defenseReady = types.every(type => Object.hasOwn(target.defenses, type));
    target.conditionImmune = body.conditionImmune === true;
    return true;
  }
  if (body.kind === 'spell-save') {
    check(p.stage === 'save', 'Czar nie oczekuje teraz na rzut obronny.');
    const t = p.targets.find(t => t.id === body.targetId), target = b.fighters.find(f => f.id === t?.id);
    check(t && t.saved === undefined && controlled(target), 'Rzut obronny wykonuje właściciel celu lub GM dla potwora.');
    const autoFail = automaticSaveFailure(target, p.spec.save) || p.spec.autoFailCreatureType && target.creatureType === p.spec.autoFailCreatureType;
    if (autoFail) {
      t.saved = false;
      target.spellConditions = (target.spellConditions ?? []).filter(e => e.kind !== 'mind-sliver');
    } else {
      const roll = d20({ ...body, disadvantage: body.disadvantage || conditionSaveDisadvantage(target, p.spec.save) || hexDisadvantage(b, target, p.spec.save) || hasSpellCondition(target, 'enfeebled') && p.spec.save === 'str', advantage: body.advantage || barbarianSaveAdvantage(target, p.spec.save) });
      t.saved = roll + target.saves[p.spec.save] + timedRollModifier(target, body) + (target.characterId ? luckBonus(db, target.characterId, body.luckRoll) : 0) - consumeSavePenalty(target, body.mindSliverRoll) >= p.dc;
    }
    log(b, `${target.name}: rzut obronny przeciw ${p.spellName} — ${t.saved ? 'sukces' : 'porażka'}.`);
    if (p.targets.every(t => t.saved !== undefined)) {
      if (!p.spec.half && !p.spec.successRider && p.targets.every(t => t.saved)) b.pending = null;
      else p.stage = 'effect';
    }
    return true;
  }
  check(p.delayedDamageId || p.zoneEvent ? gm || controlled(resolver) : controlled(actor), 'Tę część czaru rozstrzyga osoba rzucająca czar lub właściciel celu obrażeń opóźnionych/strefy.');
  if (body.kind === 'spell-attack') {
    check(p.stage === 'attack', 'Czar nie oczekuje teraz na atak.');
    const target = b.fighters.find(f => f.id === p.targets[0].id);
    const conditions = conditionAttackModifiers(actor, target, body);
    recordAttackRoll(b, actor, body, log);
    const roll = d20({ ...body, advantage: body.advantage || conditions.advantage || hasSpellCondition(target, 'guiding-bolt') || bondAdvantage(actor, target) || vowAttackAdvantage(actor, target) || barbarianAttackAdvantage(actor, target) || wolfAttackAdvantage(b, actor, target) }, conditions.disadvantage || spellDisadvantage(actor) || bondAdvantage(target, actor) || target.dodge || target.attackDisadvantage || Boolean(actor.mockery));
    target.spellConditions = (target.spellConditions ?? []).filter(e => e.kind !== 'guiding-bolt');
    consumeSpellAttack(actor);
    actor.mockery = null;
    const attackModifier = timedRollModifier(actor, body);
    const hit = roll !== 1 && (roll === 20 || roll + p.attackBonus + attackModifier >= timedAc(target));
    log(b, `${actor.name} → ${target.name}: ${p.spellName} — ${hit ? roll === 20 ? 'trafienie krytyczne' : 'trafienie' : 'pudło'}.`);
    if (!hit && p.spec.missHalf) { p.missed = true; p.targets[0].saved = true; p.stage = 'effect'; p.critical = false; p.hexDice = 0; }
    else if (!hit) advanceProjectile(b, p);
    else { p.stage = 'effect'; p.critical = roll === 20 || conditions.criticalOnHit; p.attackTotal = roll + p.attackBonus + attackModifier; p.hexDice = hexActive(actor, target) ? (p.critical ? 2 : 1) : 0; }
    return true;
  }
  check(p.stage === 'effect', 'Najpierw wykonaj atak lub rzuty obronne.');
  check(['heal', 'temp-hp'].includes(p.spec.mode) || p.targets.every(t => t.saved && !p.spec.half && !p.spec.successRider || t.defenseReady), 'GM musi zatwierdzić odporności, niewrażliwości i podatności celów.');
  const dice = spellDamageDice(p.spec, p.critical);
  check(Array.isArray(body.rolls) && body.rolls.length === dice.length && body.rolls.every((n, i) => die(n, dice[i].sides)), 'Podaj wynik każdej kości czaru.');
  check(!p.hexDice || Array.isArray(body.hexRolls) && body.hexRolls.length === p.hexDice && body.hexRolls.every(n => die(n, 6)), 'Hex: podaj dodatkowe k6 (dwie przy trafieniu krytycznym).');
  const damageMode = ['attack', 'save'].includes(p.spec.mode);
  check(!damageMode || !hasSpellCondition(actor, 'enfeebled') || die(body.enfeeblementRoll, 8), 'Ray of Enfeeblement: podaj k8 odejmowane od obrażeń.');
  const total = Math.max(0, body.rolls.reduce((a, n) => a + n, 0) + p.spec.bonus - (damageMode && hasSpellCondition(actor, 'enfeebled') ? body.enfeeblementRoll : 0));
  for (const t of p.targets) {
    const target = b.fighters.find(f => f.id === t.id);
    if ((p.spec.concentrationRounds || timedSpellDefinitions[p.spellId]?.concentration) && (!actor.concentration || actor.concentrationKey !== p.concentrationKey)) continue;
    if (['timed-save', 'timed-condition'].includes(p.spec.mode)) {
      if (!t.saved && !t.conditionImmune) applyTimedEffect(db, b, actor, target, { id: p.spellId, level: p.spellLevel, name: p.spellName }, p.castingLevel, p.castingId, { condition: p.conditionChoice, dc: p.dc });
    } else if (p.spec.mode === 'condition') {
      if (!t.conditionImmune && (!t.saved || p.spec.successRider)) addSpellCondition(b, target, actor, t.saved ? 'enfeebled-miss' : p.spec.rider, t.saved ? {} : { concentrationKey: actor.concentrationKey, expiresRound: b.round + 10, dc: p.dc, save: p.spec.save });
      log(b, `${target.name}: ${p.spellName} — ${t.conditionImmune ? 'odporność na stan' : t.saved ? 'udany rzut obronny' : p.spec.rider}.`);
    } else if (p.spec.mode === 'temp-hp') {
      target.tempHp = Math.max(target.tempHp ?? 0, total);
      persistVitals(db, target); log(b, `${target.name}: ${target.tempHp} tymczasowych PW (nie sumują się).`);
    } else if (p.spec.mode === 'heal') {
      check(!healingBlocked(target), 'Cel nie może teraz odzyskiwać PW.');
      const restored = Math.min(p.spec.fullHeal ? target.maxHp : total, Math.max(0, target.maxHp - target.hp));
      target.hp += restored;
      for (const kind of p.spec.endsConditions ?? []) endCondition(db, target, kind);
      if (target.hp > 0) { target.deathFailures = 0; target.deathSuccesses = 0; }
      persistVitals(db, target); log(b, `${p.spellName} → ${target.name}: odzyskano ${restored} PW.`);
    } else {
      const rawParts = p.spec.components ? spellDamageParts(p.spec, body.rolls, hasSpellCondition(actor, 'enfeebled') ? body.enfeeblementRoll : 0) : [{ type: p.spec.type, amount: total }];
      // Legacy pending actions can predate typed defenses.
      const defenses = t.defenses ?? { [p.spec.type]: { immune: t.multiplier === 0, resistant: t.multiplier === 0.5, vulnerable: t.multiplier === 2 } };
      const parts = defendSpellDamage(rawParts, t.saved, p.spec.half, defenses, target.psiReduction ?? 0);
      target.psiReduction = 0;
      const amount = parts.reduce((sum, part) => sum + part.amount, 0);
      damage(db, target, amount, p.critical, null, true);
      scheduleSpellDamage(b, actor, target, p);
      if (!t.saved && ['guiding-bolt', 'ray-of-frost', 'wrath', 'shocking-grasp', 'starry-wisp', 'mind-sliver', 'no-reactions'].includes(p.spec.rider)) addSpellCondition(b, target, actor, p.spec.rider, ['shocking-grasp', 'no-reactions'].includes(p.spec.rider) ? { expiresOnTargetStart: true } : {});
      if (p.spec.rider === 'disintegrated' && !t.saved && amount > 0 && target.lastDamage?.hpBefore > 0 && target.hp === 0) {
        target.disintegrated = true; target.deathFailures = 3; target.deathSuccesses = 0; persistVitals(db, target);
        log(b, `${target.name}: Disintegrate — dezintegracja; powrót wymaga True Resurrection lub Wish.`);
      }
      if (['chill-touch', 'poisoned'].includes(p.spec.rider) && !t.conditionImmune && !(p.spec.rider === 'poisoned' && hasCondition(target, 'petrified'))) addSpellCondition(b, target, actor, p.spec.rider);
      for (const part of parts) reflectThoughtShield(db, b, target, p.delayedDamageId ? b.fighters.find(f => f.id === p.sourceId) : actor, part.type, part.amount, damage, log);
      if (p.hexDice) {
        const hexType = actor.hex?.damageType ?? 'nekrotyczne';
        damage(db, target, Math.max(0, body.hexRolls.reduce((sum, n) => sum + n, 0) - enfeeblementReduction(actor, body.hexEnfeeblementRoll)), false, hexType);
        reflectThoughtShield(db, b, target, actor, hexType, target.lastDamage.amount, damage, log);
      }
      if (!t.saved && p.spec.rider === 'mockery') target.mockery = { expiresRound: b.round + (b.fighters.indexOf(target) < b.turn ? 1 : 0) };
      if (!t.saved && p.spec.rider === 'push') log(b, `${target.name}: odepchnięcie 10 stóp — położenie ustala GM.`);
      if (!t.saved && p.spec.rider === 'pull') log(b, `${target.name}: Thorn Whip — można przyciągnąć do 10 stóp, jeśli cel jest Large lub mniejszy; potwierdza MG.`);
      if (p.spec.repelling) log(b, `${target.name}: Repelling Blast — można odepchnąć do 10 stóp, jeśli cel jest Large lub mniejszy; potwierdza MG.`);
      if (!t.saved && p.spec.rider === 'flee' && !target.reaction && target.hp > 0) {
        target.reaction = 'Dissonant Whispers — ruch';
        log(b, `${target.name}: zużywa reakcję na oddalenie się najbezpieczniejszą trasą — trasę ustala GM.`);
      }
      log(b, `${p.spellName} → ${target.name}: ${amount} obrażeń (${parts.map(part => `${part.amount} ${part.type}`).join(' + ')}).`);
    }
  }
  if (p.spec.gmNote) log(b, `${p.spellName}: ${p.spec.gmNote}`);
  if (p.delayedDamageId) b.delayedSpellDamage = (b.delayedSpellDamage ?? []).filter(e => e.id !== p.delayedDamageId);
  advanceProjectile(b, p);
  return true;
}
