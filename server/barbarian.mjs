import { fighterIndomitable } from './fighter.mjs';
import { barbarianRageStarted, barbarianSaveTotal } from './barbarian-features.mjs';
import { indomitableTotal, brutalSaveDisadvantage, consumeBrutalSave } from '../shared/barbarian.mjs';
import { speciesSaveAdvantage, speciesD20 } from '../shared/species.mjs';
import { timedSaveModifier } from '../shared/timed-effects.mjs';
import { exhaustionPenalty, socialAdvantage, conditionCheckAdvantage } from '../shared/conditions.mjs';
import { automaticCheckFailure, automaticSaveFailure, conditionCheckDisadvantage, conditionDefinitions, conditionSaveDisadvantage, conditionSaveAdvantage, hasCondition, isIncapacitated } from '../shared/conditions.mjs';
import { persistConditionState } from './conditions.mjs';
import { endConcentration } from './concentration.mjs';
import { timedRollModifier } from '../shared/timed-effects.mjs';
import { consumeSavePenalty, hasSpellCondition, spellSpeed, spellFlySpeed, spellClimbSpeed } from './spell-conditions.mjs';
import { luckBonus } from './warlock-features.mjs';
import { hexDisadvantage } from '../shared/warlock.mjs';
import { primalSkills, barbarianSaveAdvantage, wildHeartAnimals } from '../shared/barbarian.mjs';
import { characterTraits } from '../shared/character-traits.mjs';
import { resourceState, saveResources } from './spell-resources.mjs';
import { statisticsSummary } from './statistics-summary.mjs';
import definitions from '../shared/statistics.json' with { type: 'json' };

const check = (ok, message) => { if (!ok) throw new Error(message); };
export function recordAttackRoll(b, actor, body, log) {
  const ownTurn = b.fighters[b.turn].id === actor.id;
  if (body.reckless === true) {
    check(ownTurn && actor.rageProfile?.recklessAttack && !actor.attackRollMade, 'Reckless Attack wybierasz tylko przy pierwszym rzucie na atak we własnej turze od 2. poziomu barbarzyńcy.');
    actor.recklessActive = true;
    log(b, `${actor.name}: Reckless Attack — ataki z Siły oraz ataki przeciw tej postaci mają ułatwienie do początku jej następnej tury.`);
  }
  if (ownTurn) actor.attackRollMade = true;
}
export function endRage(f) { f.rage = null; }
export function extendRage(b, f) {
  if (f.rage && !f.rageProfile.persistent) f.rage.expiresRound = Math.min(f.rage.maxRound, b.round + 1);
}
export function syncRage(db, b) {
  for (const f of b.fighters) {
    if (!f.rage) continue;
    const heavy = db.prepare(`SELECT 1 FROM character_items i JOIN armor_catalog a ON a.id = i.armor_id
      WHERE i.character_id = ? AND i.equipped = 1 AND a.category = 'heavy'`).get(f.characterId);
    const reachedLimit = b.round > f.rage.maxRound || b.round === f.rage.maxRound && b.turn >= b.fighters.indexOf(f);
    if (heavy || f.unconscious || (f.hp === 0 && !f.relentlessRagePending) || (!f.rageProfile.persistent && f.incapacitated) || reachedLimit) endRage(f);
  }
}
export function handleBarbarian({ db, b, body, gm, canControl, activeMember, persistVitals, log }) {
  if (!['wolf-aura', 'eagle-flight', 'rage', 'rage-extend', 'rage-end', 'rage-recover', 'relentless-rage', 'ability-check', 'saving-throw', 'condition', 'rage-force-save'].includes(body.kind)) return false;
  const f = b.fighters.find(f => f.id === (body.actorId ?? b.fighters[b.turn].id));
  check(f && activeMember(db, b.sessionId, f) && (canControl(f) || gm && ['condition', 'rage-force-save', 'wolf-aura'].includes(body.kind)), 'Nie możesz sterować tym uczestnikiem.');
  const state = f.characterId ? resourceState(db, f.characterId) : null;
  const p = f.rageProfile;
  const d20 = advantage => {
    body = { ...body, roll: speciesD20(f, body.roll, body.halflingRoll), roll2: speciesD20(f, body.roll2, body.halflingRoll2) };

    const adv = Boolean(advantage || body.advantage), dis = Boolean(body.disadvantage || body.hexDisadvantage);
    check(Number.isInteger(body.roll) && body.roll >= 1 && body.roll <= 20 && (adv === dis || Number.isInteger(body.roll2) && body.roll2 >= 1 && body.roll2 <= 20), 'Podaj k20 i drugą kość przy ułatwieniu lub utrudnieniu.');
    return adv === dis ? body.roll : adv ? Math.max(body.roll, body.roll2) : Math.min(body.roll, body.roll2);
  };
  if (body.kind === 'condition') {
    check(!b.pending, 'Najpierw rozstrzygnij rozpoczęte działanie.');
    check(!['charmed', 'frightened', 'grappled', 'exhaustion'].includes(body.condition), 'Użyj panelu źródeł stanów lub poziomu Exhaustion.');
    check(gm && Object.hasOwn(conditionDefinitions, body.condition) && typeof body.enabled === 'boolean', 'Stan nakłada GM.');
    check(!(body.enabled && body.condition === 'poisoned' && hasCondition(f, 'petrified')), 'Petrified daje niewrażliwość na Poisoned.');
    f.manualConditions = (f.manualConditions ?? []).filter(c => c !== body.condition);
    if (body.enabled) f.manualConditions.push(body.condition);
    f[body.condition] = body.enabled;
    persistConditionState(db, f);
    if (isIncapacitated(f) && (hasCondition(f, 'unconscious') || !p?.persistent)) endRage(f);
    if (isIncapacitated(f)) {
      endConcentration(db, f);
    }
    log(b, `${f.name}: ${body.condition} — ${body.enabled ? 'aktywny' : 'usunięty'}.`);
    return true;
  }
  if (body.kind === 'relentless-rage') {
    check(f.relentlessRagePending && f.deathFailures < 3, 'Brak rzutu Relentless Rage.');
    const dc = f.relentlessRagePending.dc;
    const capture = {};
    let total = body.decline === true ? -Infinity : barbarianSaveTotal(db, b, f, 'con', body, 0, null, capture);
    if (total < dc && body.fanaticalRoll != null && body.decline !== true) {
      check(p.zealot && f.level >= 6 && f.rage && !f.rage.fanaticalUsed, 'Fanatical Focus jest niedostępne.');
      f.rage.fanaticalUsed = true;
      total = barbarianSaveTotal(db, b, f, 'con', { roll: body.fanaticalRoll, roll2: body.fanaticalRoll2, advantage: capture.advantage, disadvantage: capture.disadvantage }, p.damage, capture.modifier);
    }
    const success = total >= dc;
    if (body.decline !== true) { state.relentlessRageDC = dc + 5; f.relentlessRageDC = dc + 5; }
    f.relentlessRagePending = null;
    if (success) { f.hp = Math.min(f.maxHp, 2 * f.level); f.deathSuccesses = 0; f.deathFailures = 0; }
    else endRage(f);
    saveResources(db, f.characterId, state); persistVitals(db, f);
    log(b, `${f.name}: Relentless Rage, ST ${dc} — ${success ? `sukces, ${f.hp} PW` : '0 PW; Szał zakończony'}.`);
    return true;
  }
  check(!b.fighters.some(a => a.relentlessRagePending || a.concentrationDC), 'Najpierw rozstrzygnij oczekujące rzuty.');
  if (['ability-check', 'saving-throw'].includes(body.kind)) {
    if (body.kind === 'saving-throw' && automaticSaveFailure(f, body.ability)) {
      log(b, `${f.name}: automatyczna porażka rzutu obronnego wynikająca ze stanu.`);
      return true;
    }
    if (body.kind === 'ability-check' && automaticCheckFailure(f, body)) { f.lastAbilityCheck = null; log(b, `${f.name}: automatyczna porażka testu wymagającego wzroku lub słuchu.`); return true; }
    check(body.kind === 'saving-throw' || f.hp > 0 && !f.incapacitated && !f.unconscious, 'Ta postać nie może teraz działać.');
    check(f.characterId && (!b.pending || b.pending.kind === 'request'), 'Najpierw rozstrzygnij działanie.');
    const c = db.prepare('SELECT * FROM characters WHERE id = ?').get(f.characterId);
    const stored = JSON.parse(db.prepare('SELECT data FROM character_statistics WHERE character_id = ?').get(f.characterId).data);
    const s = statisticsSummary(c, stored);
    const skill = body.kind === 'ability-check' ? definitions.skills.find(skill => skill.id === body.skill) : null;
    const ability = body.primal === true ? 'str' : skill?.ability ?? body.ability;
    check(definitions.abilities.some(a => a.id === ability), 'Wybierz cechę.');
    if (body.primal) check(body.kind === 'ability-check' && f.rage && p.primalKnowledge && primalSkills.includes(body.skill), 'Primal Knowledge jest niedostępne.');
    let bonus = body.kind === 'saving-throw' ? f.saves[ability] : skill ? s.skills[skill.id] : s.abilities[ability].modifier;
    if (f.wildShape && body.kind === 'ability-check') bonus = skill ? f.formSkills[skill.id] : f.formAbilities[ability];
    if (body.primal) {
      const traits = characterTraits(c, stored);
      const extra = traits.skillBonuses[skill.id];
      check(s.abilities.str.modifier != null && extra != null, 'Uzupełnij Siłę postaci.');
      bonus = s.abilities.str.modifier + s.proficiency * traits.effectiveSkills[skill.id] + extra;
    }
    check(bonus != null, 'Uzupełnij cechę postaci.');
    const automaticAdvantage = body.kind === 'saving-throw' ? (speciesSaveAdvantage(f, ability, body.condition) || barbarianSaveAdvantage(f, ability) || conditionSaveAdvantage(f, ability)) : (Boolean((f.rage || f.speciesEffects?.large) && ability === 'str') || f.species === 'Goliat (Goliath)' && body.kind === 'ability-check' && body.escapeGrapple === true || conditionCheckAdvantage(f, ability) || f.fighter?.athlete && skill?.id === 'athletics' && ability === 'str') || body.kind === 'ability-check' && socialAdvantage(f, b.fighters.find(t => t.id === body.socialTargetId));
    body = { ...body, hexDisadvantage: hexDisadvantage(b, f, ability, body.kind === 'saving-throw') || hasSpellCondition(f, 'enfeebled') && ability === 'str' || body.kind === 'ability-check' && (conditionCheckDisadvantage(f, ability) || body.skill === 'perception' && body.requiresSight && body.lightlyObscured === true) || body.kind === 'saving-throw' && (brutalSaveDisadvantage(f) || conditionSaveDisadvantage(f, ability)) };
    const selectedRoll = d20(automaticAdvantage);
    const rawTotal = selectedRoll - exhaustionPenalty(f) + (body.kind === 'saving-throw' ? timedSaveModifier(f, ability) : 0) + bonus + luckBonus(db, f.characterId, body.luckRoll) + (body.kind === 'saving-throw' ? timedRollModifier(f, body) : 0) - (body.kind === 'saving-throw' ? consumeSavePenalty(f, body.mindSliverRoll) : 0);
    const original = indomitableTotal(f, ability, rawTotal);
    const total = body.kind === 'saving-throw' ? fighterIndomitable(db, f, body, original, body.dc, rawTotal - selectedRoll,
      Boolean(automaticAdvantage || body.advantage), Boolean(body.disadvantage || body.hexDisadvantage), message => log(b, message)) : original;
    check(body.dc == null || Number.isInteger(body.dc) && body.dc >= 1 && body.dc <= 100, 'Podaj poprawne ST testu.');
    b.lastRoll = { kind: body.kind, actorId: f.id, targetId: f.id, total, dc: body.dc ?? null,
      condition: body.kind === 'saving-throw' ? body.condition : undefined,
      rerollModifier: rawTotal - selectedRoll, rerollDisadvantage: Boolean(body.disadvantage || body.hexDisadvantage) };
    if (body.kind === 'saving-throw') f.lastSavingThrow = { ability, total, modifier: rawTotal - selectedRoll, advantage: Boolean(automaticAdvantage || body.advantage), disadvantage: Boolean(body.disadvantage || body.hexDisadvantage), round: b.round, turn: b.turn };
    if (body.kind === 'saving-throw') consumeBrutalSave(f);
    if (body.kind === 'ability-check') {
      check(body.dc == null || Number.isInteger(body.dc) && body.dc >= 1 && body.dc <= 100, 'Podaj poprawne ST testu.');
      f.lastAbilityCheck = body.dc == null ? null : { total, dc: body.dc, attempted: false };
    } else f.lastAbilityCheck = null;
    log(b, `${f.name}: ${body.kind === 'saving-throw' ? 'rzut obronny' : 'test'} ${skill?.label ?? ability.toUpperCase()}${body.primal ? ' (Siła, Primal Knowledge)' : ''}: ${total}.`);
    return true;
  }
  check(f.hp > 0 && !f.incapacitated && !f.unconscious, 'Ta postać nie może teraz działać.');
  check(p?.max, 'Szał jest dostępny tylko dla barbarzyńcy.');
  if (body.kind === 'wolf-aura') {
    check(gm && f.rage?.animal === 'wolf' && !b.pending, 'Zasięg Wilka potwierdza GM podczas Szału.');
    check(Array.isArray(body.targetIds) && body.targetIds.every(id => b.fighters.some(t => t.id === id && Boolean(t.characterId) !== Boolean(f.characterId) && t.hp > 0)), 'Wybierz wrogów w odległości 5 stóp.');
    f.rage.wolfTargets = [...new Set(body.targetIds)];
    log(b, `${f.name}: GM aktualizuje wrogów w zasięgu Wilka (5 stóp).`);
    return true;
  }
  if (body.kind === 'eagle-flight') {
    check(f.id === b.fighters[b.turn].id && !b.pending && !f.bonus && f.rage?.animal === 'eagle', 'Orzeł wymaga Szału i wolnej akcji dodatkowej we własnej turze.');
    f.extraMove += spellSpeed(f); f.extraClimbMove = (f.extraClimbMove ?? 0) + spellClimbSpeed(f); f.extraFlyMove = (f.extraFlyMove ?? 0) + spellFlySpeed(f); f.disengaged = true; f.bonus = 'Eagle: Dash + Disengage';
    log(b, `${f.name}: Eagle — Dash i Disengage.`);
    return true;
  }
  if (body.kind === 'rage-recover') {
    check(p.persistent && f.rageRecoveryOffered && state.persistentRageAvailable !== false, 'Odzyskanie użyć przy inicjatywie jest niedostępne.');
    f.rageUses = p.max; state.rageUses = p.max; state.persistentRageAvailable = false; f.rageRecoveryOffered = false;
  } else if (body.kind === 'rage-end') {
    check(f.rage && !b.pending, 'Szał nie jest aktywny albo trwa działanie.'); endRage(f);
  } else {
    check(f.id === b.fighters[b.turn].id && !b.pending, 'Wymagana własna tura i brak oczekującego działania.');
    if (body.kind === 'rage-force-save') {
      const target = b.fighters.find(t => t.id === body.targetId);
      check(f.rage && target && target.id !== f.id && Boolean(target.characterId) !== Boolean(f.characterId) && target.hp > 0, 'Wybierz wroga zmuszonego do rzutu obronnego.');
      check(gm, 'Wymuszenie rzutu obronnego potwierdza GM.'); extendRage(b, f);
      log(b, `${f.name}: wymuszenie rzutu obronnego na wrogu przedłuża Szał.`); return true;
    }
    check(!f.bonus, 'Akcja dodatkowa została wykorzystana.');
    if (body.kind === 'rage-extend') { check(f.rage, 'Szał nie jest aktywny.'); extendRage(b, f); }
    else {
      check(!f.rage && f.rageUses > 0, 'Brak użyć lub Szał już aktywny.');
      check(!db.prepare(`SELECT 1 FROM character_items i JOIN armor_catalog a ON a.id = i.armor_id WHERE i.character_id = ? AND i.equipped = 1 AND a.category = 'heavy'`).get(f.characterId), 'Ciężka zbroja uniemożliwia Szał.');
      check(p.wildHeart ? wildHeartAnimals.includes(body.animal) : body.animal == null, 'Wild Heart wymaga wyboru bear, eagle lub wolf przy aktywacji Szału.');
      f.rageUses--; state.rageUses = f.rageUses;
      f.rage = { expiresRound: b.round + 1, maxRound: b.round + 100, activationTurn: `${b.round}:${b.turn}` };
      barbarianRageStarted(db, b, f, body, persistVitals);
      if (p.wildHeart) {
        f.rage.animal = body.animal;
        if (body.animal === 'eagle') { f.extraMove += spellSpeed(f); f.extraClimbMove = (f.extraClimbMove ?? 0) + spellClimbSpeed(f); f.extraFlyMove = (f.extraFlyMove ?? 0) + spellFlySpeed(f); f.disengaged = true; }
      }
      f.concentration = null; f.concentrationDC = null; f.concentrationChecks = []; state.concentration = null;
      const feet = body.feet ?? 0;
      check(Number.isInteger(feet) && feet >= 0 && feet <= (p.instinctivePounce ? Math.floor(spellSpeed(f) / 2) : 0), 'Przekroczono ruch Instinctive Pounce.');
      f.pounceMoved = feet;
      if (feet) log(b, `${f.name}: Instinctive Pounce — ${feet} stóp (dodatkowy ruch przy aktywacji).`);
    }
    f.bonus = body.kind === 'rage' ? 'Szał' : 'Przedłużenie Szału';
    f.rageRecoveryOffered = false;
  }
  const latest = resourceState(db, f.characterId);
  latest.concentration = state.concentration; latest.rageUses = state.rageUses; latest.persistentRageAvailable = state.persistentRageAvailable;
  saveResources(db, f.characterId, latest);
  const labels = { rage: 'Szał aktywowany', 'rage-extend': 'Szał przedłużony', 'rage-end': 'Szał zakończony', 'rage-recover': 'Persistent Rage — użycia odzyskane' };
  log(b, `${f.name}: ${labels[body.kind]}; użycia Szału ${f.rageUses}/${p.max}.`);
  return true;
}
