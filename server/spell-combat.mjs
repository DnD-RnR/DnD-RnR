import { beginCasting, handleCasting, validateCounterspell, advanceCasting, handleMonsterCasting } from './counterspell.mjs';
import { endProtectiveSpell, queueRetaliations } from './protective-spells.mjs';
import { instantDeath } from './death-ward.mjs';
import { beginDispel, resolveDispel } from './dispel-magic.mjs';
import { hasTimedModifier, timedSaveModifier } from '../shared/timed-effects.mjs';
import { exhaustionPenalty, cannotHarm, canSeeConditionTarget } from '../shared/conditions.mjs';
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
import { automaticSaveFailure, conditionAttackModifiers, conditionSaveDisadvantage, conditionSaveAdvantage, hasCondition, isIncapacitated } from '../shared/conditions.mjs';
import { endCondition, endTimedCondition } from './conditions.mjs';
import { spellDamageDice, spellDamageParts, defendSpellDamage } from '../shared/spell-damage.mjs';
import { beginDelayedSpellDamage, scheduleSpellDamage } from './delayed-spells.mjs';
import { beginZoneDamage, createSpellZone, syncSpellZones } from './spell-zones.mjs';
import { endWildShape } from './druid.mjs';
import { createRepeatSpell } from './repeat-spells.mjs';

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
export function handleCombatSpell({ db, user, gm, b, body, canControl, activeMember, damage, persistVitals, log, resumingCast = null }) {
  const context = { db, user, gm, b, body, canControl, activeMember, damage, persistVitals, log };
  if (handleMonsterCasting(context)) return true;
  const casting = handleCasting(context);
  if (casting) { if (casting.resume) handleCombatSpell({ ...context, body: casting.resume.attempt, resumingCast: casting.resume }); return true; }
  if (resolveDispel({ db, b, body, canControl, activeMember, log })) return true;
  if (!['cast', 'spell-attack', 'spell-save', 'spell-effect', 'spell-defense', 'heat-save', 'concentration', 'condition-save', 'end-concentration', 'dismiss-effect', 'delayed-spell'].includes(body.kind)) return false;
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
    const roll = d20({ ...body, disadvantage: body.disadvantage || conditionSaveDisadvantage(caster, save) || hexDisadvantage(b, caster, save), advantage: body.advantage || barbarianSaveAdvantage(caster, save) || conditionSaveAdvantage(caster, save) });
    const success = !automaticSaveFailure(caster, save) && roll - exhaustionPenalty(caster) + caster.saves[save] + timedSaveModifier(caster, save) + timedRollModifier(caster, body) - consumeSavePenalty(caster, body.mindSliverRoll) >= effect.dc;
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
    let c;
    if (!resumingCast) {
    const parent = body.spellId === 'counterspell' ? validateCounterspell(db, b, caster, body) : null;
    check(b.pending?.kind !== 'casting' || parent, 'Najpierw rozstrzygnij okno rzucanego czaru.');
    check(caster && !caster.rage && !isIncapacitated(caster), 'Wild Shape, Szał lub stan postaci uniemożliwia rzucanie czarów.');
    check(controlled(caster) && caster.characterId && caster.hp > 0 && caster.deathFailures < 3, 'Nie możesz rzucić czaru tą postacią.');
    if (caster.wildShape) {
      const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(caster.characterId);
      check(moonSpells(character).includes(body.spellId), 'W Wild Shape możesz rzucać tylko czary Kręgu Księżyca.');
    }
    if (b.pending && !parent) {
      check(body.slot === 'reaction' && !b.suspendedAction, 'Najpierw rozstrzygnij rozpoczęte działanie.');
      b.suspendedAction = b.pending; b.pending = null;
    }
    check(caster.id === b.fighters[b.turn].id || body.slot === 'reaction', 'Poza własną turą dostępne są tylko reakcje.');
    check(!caster[body.slot] && ['action', 'bonus', 'reaction'].includes(body.slot), 'Działanie zostało już wykorzystane.');
    check(!b.fighters.some(f => f.concentrationDC), 'Najpierw rozstrzygnij rzuty koncentracji.');
    c = spendSpell(db, caster.characterId, body.spellId, body.level, body.source);
    check(c.spell.action === body.slot, 'Czas rzucania czaru nie pasuje do tego kroku tury.');
    check(!c.blocked, 'Brak wyszkolenia w założonym pancerzu blokuje rzucanie czarów.');
    const spentSlot = c.spell.level > 0 && !['arcanum', 'origin', 'paladin-smite', 'legacy'].includes(body.source);
    check(!spentSlot || !(b.slotCasters ?? []).includes(caster.id), 'W tej turze wykorzystano już miejsce na czar.');
    if (spentSlot) b.slotCasters = [...(b.slotCasters ?? []), caster.id];
    caster[body.slot] = `Czar: ${c.spell.name}`;
    endProtectiveSpell(db, caster, 'sanctuary');
    if (c.spell.duration?.includes('Koncentracja')) {
      startConcentration(db, caster, c.spell, b);
    }
    log(b, `${caster.name}: ${c.spell.name}${c.spell.level ? ` (${body.level}. krąg, ${body.source === 'paladin-smite' ? 'Paladin Smite' : body.source === 'arcanum' ? 'Mystic Arcanum' : body.source === 'legacy' ? 'Fiendish Legacy — bez miejsca' : body.source === 'origin' ? 'atut Origin' : 'zużyto miejsce'})` : ' (sztuczka)'}.`);
    if (hasTimedModifier(caster, 'slow') && !(warlockProfile(c.character, c.stats.values.cha, c.state).greatOldOne && ['Enchantment', 'Illusion'].includes(c.spell.school)) && /(^|,|\s)S(,|\s|$)/.test(c.spell.components)) {
      check(die(body.slowRoll, 4), 'Slow: podaj k4 sprawdzające 25% szansy niepowodzenia komponentu S.');
      if (body.slowRoll === 1) { if (c.spell.duration?.includes('Koncentracja')) endConcentration(db, caster); caster[body.slot] = `Slow: ${c.spell.name} nie powiódł się`; log(b, `${caster.name}: Slow — czar nie powiódł się, miejsce i działanie zużyte.`); return true; }
    }
    if (body.sanctuaryLost) { if (c.spell.duration?.includes('Koncentracja')) endConcentration(db, caster); log(b, `${caster.name}: Sanctuary — traci czar; slot i działanie zużyte.`); return true; }
    if (beginCasting(db, b, caster, c, body, spentSlot, parent)) {
      // Validate the complete effect before committing a deferred cast. SQL and
      // battle mutations from this validation are discarded, including random IDs.
      if (c.spell.id !== 'counterspell') {
        db.exec('SAVEPOINT casting_validation');
        try { handleCombatSpell({ ...context, b: structuredClone(b), resumingCast: { cast: c } }); }
        finally { db.exec('ROLLBACK TO casting_validation; RELEASE casting_validation'); }
      }
      const resume = advanceCasting(db, b, log);
      if (resume) handleCombatSpell({ ...context, body: resume.attempt, resumingCast: resume });
      return true;
    }
    } else c = resumingCast.cast;
    const wp = warlockProfile(c.character, c.stats.values.cha, c.state);
    check(!body.psychic || wp.greatOldOne && (c.spell.classes.includes('warlock') || c.profile.automatic.some(s => s.id === c.spell.id && ['Great Old One Patron', 'Eldritch Hex', 'Contact Patron'].includes(s.reason))), 'Psychic Spells wymaga czaru Warlocka i Great Old One.');
    if (c.spell.id === 'hex') {
      const target = b.fighters.find(f => f.id === body.targetIds?.[0]);
      check(!cannotHarm(caster, target), 'Charmed: nie możesz kierować Hex na sprawcę.');
      check(target && body.targetIds.length === 1 && ['str', 'dex', 'con', 'int', 'wis', 'cha'].includes(body.hexAbility), 'Hex: wybierz jeden cel i cechę.');
      caster.hex = { damageType: body.psychic ? 'psychiczne' : 'nekrotyczne', targetId: target.id, targetDefeated: target.hp === 0, defeatedRound: target.hp === 0 ? b.round : null, ability: body.hexAbility, eldritch: wp.eldritchHex, name: c.spell.name, expiresAt: Date.now() + (body.level >= 5 ? 24 : body.level >= 3 ? 8 : 1) * 3600000 };
      caster.hex.level = body.level;
      const state = resourceState(db, caster.characterId);
      state.hex = caster.hex; saveResources(db, caster.characterId, state);
      log(b, `${caster.name}: Hex → ${target.name}, ${body.hexAbility.toUpperCase()}${wp.eldritchHex ? ' — również rzuty obronne' : ''}.`);
      return true;
    }
    if (!c.spell.effect) {
      b.pending = { kind: 'request', actorId: caster.id, slot: body.slot, description: `${c.spell.name}${body.psychic ? ' (Psychic Spells: obrażenia psychiczne)' : ''} — ${c.spell.description ?? ''}\n${c.spell.upgrade ?? ''}\nZasięg i komponenty oraz efekty specjalne rozstrzyga GM. Zasób został już zużyty.` };
      return true;
    }
    const spec = { ...c.spell.effect };
    if (spec.mode === 'dispel') { beginDispel(db, b, caster, c, body, log); return true; }
    if (spec.aura) {
      check(['Radiant', 'Necrotic'].includes(body.damageTypeChoice), 'Spirit Guardians: wybierz typ obrażeń zgodny z charakterem, po potwierdzeniu przez MG.');
      spec.type = body.damageTypeChoice;
    }
    if (spec.components) spec.components = spec.components.map(part => ({ ...part, dice: part.dice + (body.level - c.spell.level) * (part.perLevel ?? 0), type: body.psychic ? 'Psychic' : part.type }));
    if (spec.effectOptions) check(spec.effectOptions.includes(body.effectChoice), 'Wybierz efekt tego czaru.');
    if (spec.optionalSave) check(typeof body.willing === 'boolean' || body.objectTarget === true, 'Potwierdź dobrowolność celu albo wybierz przedmiot.');
    if (spec.optionalSave && body.objectTarget === true) {
      check(body.confirmedUnwornUncarried === true && typeof body.objectName === 'string' && body.objectName.trim() && body.objectName.length <= 120, 'MG musi potwierdzić widoczny, nienoszony i nieprzenoszony przedmiot.');
      b.pending = { kind: 'request', actorId: caster.id, slot: body.slot, description: `${c.spell.name}: ${body.effectChoice} — ${body.objectName}. MG zmienia rozmiar przedmiotu; koncentracja i czas są śledzone.` }; return true;
    }
    if (spec.conditionOptions) check(spec.conditionOptions.includes(body.conditionChoice), 'Wybierz stan obsługiwany przez ten czar.');
    if (body.psychic && spec.type) spec.type = 'Psychic';
    if (spec.mode === 'shield') {
      caster.shieldLevel = body.level;
      if (!caster.shieldAC) { caster.ac += 5; caster.shieldAC = 5; }
      log(b, `${caster.name}: Shield — osłona do początku następnej własnej tury.`);
      return true;
    }
    const targets = spec.self ? [caster] : Array.isArray(body.targetIds) ? body.targetIds.map(id => b.fighters.find(f => f.id === id)) : [];
    const projectiles = spec.cantripBeams ? c.character.level >= 17 ? 4 : c.character.level >= 11 ? 3 : c.character.level >= 5 ? 2 : 1 : spec.projectiles ? spec.projectiles + (body.level - c.spell.level) * (spec.projectilesPerLevel ?? 0) : 0;
    const maxTargets = spec.maxTargets ? spec.maxTargets + (body.level - c.spell.level) * (spec.targetsPerLevel ?? 0) : spec.extraTargets ? body.level - 1 : spec.area ? 50 : 1;
    check(projectiles ? targets.length === projectiles && targets.every(Boolean) : (targets.length > 0 || spec.zone || spec.optionalTarget) && targets.length <= maxTargets && targets.every(Boolean) && new Set(targets.map(t => t.id)).size === targets.length, 'Wybierz właściwe cele czaru i cel dla każdego promienia.');
    if (spec.willingOnly) check(body.willing === true, 'Ten czar wymaga dobrowolnego celu, co potwierdza MG.');
    if (c.spell.id === 'feather-fall') {
      check(body.confirmedFalling === true && targets.every(t => t.falling), 'Feather Fall: MG potwierdza do pięciu spadających stworzeń w 60 stopach.');
      check(caster.falling || b.fighters.some(t => t.falling && canSeeConditionTarget(caster, t)), 'Feather Fall wymaga własnego spadania albo widocznego spadającego stworzenia jako wyzwalacza.');
    }
    if (!(spec.optionalSave && body.willing) && !['heal', 'temp-hp', 'timed', 'restore-condition'].includes(spec.mode)) check(targets.every(t => spec.aura && (t.id === caster.id || body.excludedIds?.includes(t.id)) || !cannotHarm(caster, t)), 'Charmed: nie możesz obejmować sprawcy szkodliwym czarem.');
    if (body.requiresSight === true || spec.requiresSight) check(targets.every(t => canSeeConditionTarget(caster, t)), 'Invisible / Blinded: ten efekt wymaga widzianego celu; MG musi potwierdzić wyjątek widoczności.');
    if (spec.humanoid) check(targets.every(t => t.creatureType === 'Humanoid' || !t.creatureType && body.confirmedHumanoid === true), 'Hold Person: cel musi być Humanoidem; nieznany typ potwierdza GM.');
    check(targets.every(t => t.deathFailures < 3), 'Zwykły czar nie przywraca życia martwemu celowi.');
    if (c.spell.id === 'power-word-kill' && targets[0].hp <= 100) {
      const target = targets[0], hpBefore = target.hp, killed = instantDeath(db, target, persistVitals);
      if (killed && hpBefore > 0) target.fiendDefeatPending = { sourceId: caster.id };
      log(b, `${c.spell.name} → ${target.name}: ${killed ? 'natychmiastowa śmierć bez obrażeń' : 'Death Ward neguje efekt i kończy się'}.`);
      return true;
    }
    if (spec.mode === 'restore-condition') {
      for (const target of targets) endCondition(db, target, body.conditionChoice);
      log(b, `${c.spell.name}: zakończono ${body.conditionChoice} na ${targets.map(t => t.name).join(', ')}.`); return true;
    }
    if (spec.repeatSave) check(c.dc != null && targets.every(t => t.saves[spec.repeatSave] != null), 'Uzupełnij ST czaru i powtórny rzut obronny celu.');
    if (timedSpellDefinitions[c.spell.id]?.mageArmor) check(targets.every(t => !t.wearingArmor && t.dexModifier != null), 'Mage Armor wymaga celu bez pancerza i znanego modyfikatora DEX.');
    if (spec.ward) check(c.dc != null, 'Uzupełnij ST Sanctuary.');
    if (spec.mode === 'timed' || spec.optionalSave && body.willing) {
      const castingId = randomUUID();
      for (const target of targets) applyTimedEffect(db, b, caster, target, c.spell, body.level, castingId, { effectChoice: body.effectChoice, dc: c.dc, damageType: body.psychic ? 'Psychic' : undefined });
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
    if (spec.save && ['save', 'condition', 'timed-save'].includes(spec.mode)) check(c.dc !== null && targets.filter(t => spec.binding !== 'entangle' || t.id !== caster.id).every(t => automaticSaveFailure(t, spec.save) || t.saves?.[spec.save] != null), 'Uzupełnij ST czaru i modyfikator rzutu obronnego celów.');
    if (spec.zone) {
      syncSpellZones(db, b);
      const options = {};
      let members = targets.map(t => t.id);
      if (spec.binding === 'entangle') { options.excludedIds = [caster.id]; options.excludedCharacterIds = [caster.characterId]; }
      if (spec.binding === 'web') { check(typeof body.webAnchored === 'boolean', 'MG musi potwierdzić zakotwiczenie Web albo jego brak.'); options.webAnchored = body.webAnchored; }
      if (spec.aura) {
        check(Array.isArray(body.excludedIds) && new Set(body.excludedIds).size === body.excludedIds.length && body.excludedIds.every(id => b.fighters.some(f => f.id === id)), 'Wybierz stworzenia wyłączone z działania Spirit Guardians przy rzucaniu.');
        options.excludedIds = [...new Set([caster.id, ...body.excludedIds])];
        options.excludedCharacterIds = b.fighters.filter(f => options.excludedIds.includes(f.id) && f.characterId).map(f => f.characterId);
      }
      if (spec.wall) {
        check(body.wallShape === 'line' ? ['front', 'back'].includes(body.wallSide) : body.wallShape === 'ring' && ['inside', 'outside'].includes(body.wallSide), 'Wybierz kształt ściany i jej gorącą stronę.');
        check(Array.isArray(body.zoneMemberIds) && new Set(body.zoneMemberIds).size === body.zoneMemberIds.length && body.zoneMemberIds.every(id => b.fighters.some(f => f.id === id && f.deathFailures < 3)), 'Wybierz cele w ścianie lub do 10 stóp od gorącej strony.');
        members = [...new Set([...members, ...body.zoneMemberIds])];
        Object.assign(options, { wallShape: body.wallShape, wallSide: body.wallSide, wallIds: targets.map(t => t.id) });
      }
      const zone = createSpellZone(db, b, caster, c.spell, body.level, spec, c.dc, members, options);
      if (!spec.noInitialDamage) beginZoneDamage(b, zone, targets.map(t => t.id), false, 'initial');
      log(b, `${c.spell.name}: aktywna strefa. ${spec.gmNote}`);
      return true;
    }
    b.pending = { kind: 'spell', actorId: caster.id, effectChoice: body.effectChoice, conditionChoice: body.conditionChoice, spellName: c.spell.name, spellId: c.spell.id, spellLevel: c.spell.level, castingLevel: body.level, castingId: randomUUID(), stage: spec.mode === 'attack' ? 'attack' : spec.save && ['save', 'condition', 'timed-save'].includes(spec.mode) ? 'save' : 'effect', spec,
      concentrationKey: caster.concentrationKey, attackBonus: c.attack, dc: c.dc, targets: (projectiles ? targets.slice(0, 1) : targets).map(t => ({ id: t.id })), remainingTargets: projectiles ? targets.slice(1).map(t => t.id) : [] };
    if (spec.repeatable) {
      if (spec.heatMetal) check(body.confirmedMetal === true && typeof body.objectName === 'string' && body.objectName.trim() && body.objectName.length <= 120, 'Heat Metal: wskaż wytworzony metalowy przedmiot i potwierdź z MG jego widoczność oraz zasięg.');
      createRepeatSpell(db, b, caster, b.pending, spec.heatMetal ? { objectName: body.objectName.trim() } : {});
      if (!targets.length) b.pending = null;
    }
    return true;
  }
  if (body.kind === 'concentration') {
    check(controlled(caster) && caster.hp > 0 && caster.concentrationDC, 'Brak testu koncentracji do wykonania.');
    const roll = d20({ ...body, disadvantage: body.disadvantage || hexDisadvantage(b, caster, 'con') }), bonus = caster.saves.con;
    check(bonus != null, 'Uzupełnij rzut obronny na Kondycję.');
    const success = roll - exhaustionPenalty(caster) + bonus + timedRollModifier(caster, body) + luckBonus(db, caster.characterId, body.luckRoll) - consumeSavePenalty(caster, body.mindSliverRoll) >= caster.concentrationDC;
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
  const actor = p.delayedDamageId || p.zoneEvent || p.reactive ? b.fighters.find(f => f.id === p.sourceId) ?? p.reactiveSource ?? { id: p.sourceId, spellConditions: [] } : resolver;
  if (body.kind === 'heat-save') {
    check(p.stage === 'heat-save', 'Brak rzutu po obrażeniach Heat Metal.');
    const t = p.heatSaves.find(t => t.id === body.targetId && !t.resolved), target = b.fighters.find(f => f.id === t?.id);
    check(t && controlled(target), 'CON wykonuje właściciel celu lub MG dla potwora.');
    const roll = d20({ ...body, disadvantage: body.disadvantage || hexDisadvantage(b, target, 'con') });
    const success = roll - exhaustionPenalty(target) + target.saves.con + timedRollModifier(target, body) + (target.characterId ? luckBonus(db, target.characterId, body.luckRoll) : 0) - consumeSavePenalty(target, body.mindSliverRoll) >= p.dc;
    const dropped = t.canDrop && (!success || body.dropObject === true);
    if (dropped) {
      const effect = b.repeatSpells?.find(e => e.id === p.repeatSpellId);
      if (effect) effect.contactIds = effect.contactIds.filter(id => id !== target.id);
    } else addSpellCondition(b, target, actor, 'heated-metal', { expiresOnSourceStart: true });
    t.resolved = true;
    log(b, `${target.name}: Heat Metal CON — ${success ? 'sukces' : 'porażka'}; ${dropped ? 'upuszcza przedmiot (ekwipunek aktualizuje MG)' : 'nie upuszcza: utrudnienie ataków i testów do początku następnej tury rzucającego'}.`);
    if (p.heatSaves.every(t => t.resolved)) b.pending = null;
    return true;
  }
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
    target.shapeShifted = p.spec.rider === 'moonbeam' && body.shapeShifted === true;
    if (p.spec.heatMetal) {
      target.heatHolder = body.heatHolder === true;
      target.canDrop = body.canDrop === true;
      check(!target.heatHolder || fighter.saves.con != null, 'Uzupełnij CON celu trzymającego lub noszącego przedmiot.');
    }
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
      const roll = d20({ ...body, disadvantage: body.disadvantage || conditionSaveDisadvantage(target, p.spec.save) || hexDisadvantage(b, target, p.spec.save) || hasSpellCondition(target, 'enfeebled') && p.spec.save === 'str', advantage: body.advantage || barbarianSaveAdvantage(target, p.spec.save) || conditionSaveAdvantage(target, p.spec.save) });
      t.saved = roll - exhaustionPenalty(target) + target.saves[p.spec.save] + timedSaveModifier(target, p.spec.save) + timedRollModifier(target, body) + (target.characterId ? luckBonus(db, target.characterId, body.luckRoll) : 0) - consumeSavePenalty(target, body.mindSliverRoll) >= p.dc;
    }
    log(b, `${target.name}: rzut obronny przeciw ${p.spellName} — ${t.saved ? 'sukces' : 'porażka'}.`);
    if (p.targets.every(t => t.saved !== undefined)) {
      if (!p.spec.half && !p.spec.successRider && p.targets.every(t => t.saved)) b.pending = null;
      else p.stage = 'effect';
    }
    return true;
  }
  check(p.delayedDamageId || p.zoneEvent || p.reactive ? gm || controlled(resolver) || p.reactive && controlled(actor) : controlled(actor), 'Tę część czaru rozstrzyga właściciel efektu, celu obrażeń automatycznych lub MG.');
  if (body.kind === 'spell-attack') {
    if (body.sanctuaryLost) { log(b, `${p.spellName}: Sanctuary — ten atak stracony.`); advanceProjectile(b, p); return true; }
    check(p.stage === 'attack', 'Czar nie oczekuje teraz na atak.');
    const target = b.fighters.find(f => f.id === p.targets[0].id);
    check(!cannotHarm(actor, target), 'Charmed: nie możesz atakować sprawcy.');
    const conditions = conditionAttackModifiers(actor, target, body);
    endProtectiveSpell(db, actor, 'sanctuary');
    recordAttackRoll(b, actor, body, log);
    const roll = d20({ ...body, advantage: body.advantage || conditions.advantage || hasSpellCondition(target, 'guiding-bolt') || bondAdvantage(actor, target) || vowAttackAdvantage(actor, target) || barbarianAttackAdvantage(actor, target) || wolfAttackAdvantage(b, actor, target) }, conditions.disadvantage || spellDisadvantage(actor) || bondAdvantage(target, actor) || target.dodge || target.attackDisadvantage || Boolean(actor.mockery));
    target.spellConditions = (target.spellConditions ?? []).filter(e => e.kind !== 'guiding-bolt');
    consumeSpellAttack(actor);
    actor.mockery = null;
    const attackModifier = timedRollModifier(actor, body);
    const hit = roll !== 1 && (roll === 20 || roll - exhaustionPenalty(actor) + p.attackBonus + attackModifier >= timedAc(target));
    log(b, `${actor.name} → ${target.name}: ${p.spellName} — ${hit ? roll === 20 ? 'trafienie krytyczne' : 'trafienie' : 'pudło'}.`);
    if (!hit && p.spec.missHalf) { p.missed = true; p.targets[0].saved = true; p.stage = 'effect'; p.critical = false; p.hexDice = 0; }
    else if (!hit) advanceProjectile(b, p);
    else { p.stage = 'effect'; p.critical = roll === 20 || conditions.criticalOnHit; p.hit = { melee: body.attackRange === 'melee' || body.attackRange !== 'ranged' && ['chill-touch','shocking-grasp','thorn-whip','spiritual-weapon'].includes(p.spellId), within5Feet: body.within5Feet === true }; p.attackTotal = roll - exhaustionPenalty(actor) + p.attackBonus + attackModifier; p.hexDice = hexActive(actor, target) ? (p.critical ? 2 : 1) : 0; }
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
    if (p.spec.binding) {
      const zone = b.spellZones?.find(z => z.id === p.zoneId);
      if (zone && !t.saved && !t.conditionImmune && !zone.restrainedIds.includes(target.id)) zone.restrainedIds.push(target.id);
    } else if (['timed-save', 'timed-condition'].includes(p.spec.mode)) {
      if (!t.saved && !t.conditionImmune) applyTimedEffect(db, b, actor, target, { id: p.spellId, level: p.spellLevel, name: p.spellName }, p.castingLevel, p.castingId, { condition: p.conditionChoice, effectChoice: p.effectChoice, dc: p.dc });
    } else if (p.spec.mode === 'condition') {
      if (!t.conditionImmune && (!t.saved || p.spec.successRider)) addSpellCondition(b, target, actor, t.saved ? 'enfeebled-miss' : p.spec.rider, { spellId: p.spellId, level: p.castingLevel, castingId: p.castingId, ...(t.saved ? {} : { concentrationKey: actor.concentrationKey, expiresRound: b.round + 10, dc: p.dc, save: p.spec.save }) });
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
      queueRetaliations(b, target, actor, p.hit);
      if (amount > 0) endProtectiveSpell(db, actor, 'sanctuary');
      damage(db, target, amount, p.critical, null, true);
      if (p.spec.heatMetal) t.heatDamaged = amount > 0 && t.heatHolder && target.deathFailures < 3 && (target.characterId || target.hp > 0);
      if (p.spec.rider === 'moonbeam' && !t.saved && (target.wildShape || t.shapeShifted)) {
        endWildShape(target);
        if (target.characterId) { const state = resourceState(db, target.characterId); state.wildShape = null; saveResources(db, target.characterId, state); }
        const zone = b.spellZones?.find(z => z.id === p.zoneId);
        if (zone && !zone.shapeLockedIds.includes(target.id)) zone.shapeLockedIds.push(target.id);
        log(b, `${target.name}: Moonbeam cofa przemianę; ponowna przemiana zablokowana do opuszczenia cylindra. Inne formy niż Wild Shape aktualizuje MG.`);
      }
      scheduleSpellDamage(b, actor, target, p);
      if (!t.saved && ['guiding-bolt', 'ray-of-frost', 'wrath', 'shocking-grasp', 'starry-wisp', 'mind-sliver', 'no-reactions'].includes(p.spec.rider)) addSpellCondition(b, target, actor, p.spec.rider, ['shocking-grasp', 'no-reactions'].includes(p.spec.rider) ? { expiresOnTargetStart: true } : {});
      if (p.spec.rider === 'disintegrated' && !t.saved && amount > 0 && target.lastDamage?.hpBefore > 0 && target.hp === 0) {
        target.disintegrated = true; target.deathFailures = 3; target.deathSuccesses = 0; persistVitals(db, target);
        log(b, `${target.name}: Disintegrate — dezintegracja; powrót wymaga True Resurrection lub Wish.`);
      }
      if (['chill-touch', 'poisoned'].includes(p.spec.rider) && !t.conditionImmune && !(p.spec.rider === 'poisoned' && hasCondition(target, 'petrified'))) addSpellCondition(b, target, actor, p.spec.rider);
      for (const part of parts) reflectThoughtShield(db, b, target, p.delayedDamageId || p.reactive ? b.fighters.find(f => f.id === p.sourceId) : actor, part.type, part.amount, damage, log);
      if (p.hexDice) {
        const hexType = actor.hex?.damageType ?? 'nekrotyczne';
        damage(db, target, Math.max(0, body.hexRolls.reduce((sum, n) => sum + n, 0) - enfeeblementReduction(actor, body.hexEnfeeblementRoll)), false, hexType);
        reflectThoughtShield(db, b, target, actor, hexType, target.lastDamage.amount, damage, log);
      }
      if (!t.saved && p.spec.rider === 'mockery') target.mockery = { expiresRound: b.round + (b.fighters.indexOf(target) < b.turn ? 1 : 0) };
      if (!t.saved && p.spec.rider === 'push') log(b, `${target.name}: odepchnięcie 10 stóp — położenie ustala GM.`);
      if (!t.saved && p.spec.rider === 'pull') log(b, `${target.name}: Thorn Whip — można przyciągnąć do 10 stóp, jeśli cel jest Large lub mniejszy; potwierdza MG.`);
      if (p.spec.repelling) log(b, `${target.name}: Repelling Blast — można odepchnąć do 10 stóp, jeśli cel jest Large lub mniejszy; potwierdza MG.`);
      if (!t.saved && p.spec.rider === 'flee' && !hasTimedModifier(target, 'slow') && !target.reaction && target.hp > 0) {
        target.reaction = 'Dissonant Whispers — ruch';
        log(b, `${target.name}: zużywa reakcję na oddalenie się najbezpieczniejszą trasą — trasę ustala GM.`);
      }
      log(b, `${p.spellName} → ${target.name}: ${amount} obrażeń (${parts.map(part => `${part.amount} ${part.type}`).join(' + ')}).`);
    }
  }
  if (p.spec.gmNote) log(b, `${p.spellName}: ${p.spec.gmNote}`);
  if (p.spec.heatMetal && p.targets.some(t => t.heatDamaged)) { p.heatSaves = p.targets.filter(t => t.heatDamaged).map(t => ({ id: t.id, canDrop: t.canDrop })); p.stage = 'heat-save'; return true; }
  if (p.delayedDamageId) b.delayedSpellDamage = (b.delayedSpellDamage ?? []).filter(e => e.id !== p.delayedDamageId);
  advanceProjectile(b, p);
  return true;
}
