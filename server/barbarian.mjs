import { primalSkills, barbarianSaveAdvantage } from '../shared/barbarian.mjs';
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
  if (!['rage', 'rage-extend', 'rage-end', 'rage-recover', 'relentless-rage', 'ability-check', 'saving-throw', 'condition', 'rage-force-save'].includes(body.kind)) return false;
  const f = b.fighters.find(f => f.id === (body.actorId ?? b.fighters[b.turn].id));
  check(f && activeMember(db, b.sessionId, f) && (canControl(f) || gm && ['condition', 'rage-force-save'].includes(body.kind)), 'Nie możesz sterować tym uczestnikiem.');
  const state = f.characterId ? resourceState(db, f.characterId) : null;
  const p = f.rageProfile;
  const d20 = advantage => {
    const adv = Boolean(advantage || body.advantage), dis = Boolean(body.disadvantage);
    check(Number.isInteger(body.roll) && body.roll >= 1 && body.roll <= 20 && (adv === dis || Number.isInteger(body.roll2) && body.roll2 >= 1 && body.roll2 <= 20), 'Podaj k20 i drugą kość przy ułatwieniu lub utrudnieniu.');
    return adv === dis ? body.roll : adv ? Math.max(body.roll, body.roll2) : Math.min(body.roll, body.roll2);
  };
  if (body.kind === 'condition') {
    check(!b.pending, 'Najpierw rozstrzygnij rozpoczęte działanie.');
    check(gm && ['incapacitated', 'unconscious'].includes(body.condition) && typeof body.enabled === 'boolean', 'Stan nakłada GM.');
    f[body.condition] = body.enabled;
    if (body.enabled && (body.condition === 'unconscious' || !p?.persistent)) endRage(f);
    if (body.enabled) {
      f.concentration = null; f.concentrationDC = null; f.concentrationChecks = [];
      if (state) { state.concentration = null; saveResources(db, f.characterId, state); }
    }
    log(b, `${f.name}: ${body.condition} — ${body.enabled ? 'aktywny' : 'usunięty'}.`);
    return true;
  }
  if (body.kind === 'relentless-rage') {
    check(f.relentlessRagePending && f.deathFailures < 3, 'Brak rzutu Relentless Rage.');
    const dc = f.relentlessRagePending.dc;
    const success = body.decline !== true && d20(false) + f.saves.con >= dc;
    if (body.decline !== true) { state.relentlessRageDC = dc + 5; f.relentlessRageDC = dc + 5; }
    f.relentlessRagePending = null;
    if (success) { f.hp = 2 * f.level; f.deathSuccesses = 0; f.deathFailures = 0; }
    else endRage(f);
    saveResources(db, f.characterId, state); persistVitals(db, f);
    log(b, `${f.name}: Relentless Rage, ST ${dc} — ${success ? `sukces, ${f.hp} PW` : '0 PW; Szał zakończony'}.`);
    return true;
  }
  check(!b.fighters.some(a => a.relentlessRagePending || a.concentrationDC), 'Najpierw rozstrzygnij oczekujące rzuty.');
  if (['ability-check', 'saving-throw'].includes(body.kind)) {
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
    const automaticAdvantage = body.kind === 'saving-throw' ? barbarianSaveAdvantage(f, ability) : Boolean(f.rage && ability === 'str');
    const total = d20(automaticAdvantage) + bonus;
    if (body.kind === 'ability-check') {
      check(body.dc == null || Number.isInteger(body.dc) && body.dc >= 1 && body.dc <= 100, 'Podaj poprawne ST testu.');
      f.lastAbilityCheck = body.dc == null ? null : { total, dc: body.dc, attempted: false };
    } else f.lastAbilityCheck = null;
    log(b, `${f.name}: ${body.kind === 'saving-throw' ? 'rzut obronny' : 'test'} ${skill?.label ?? ability.toUpperCase()}${body.primal ? ' (Siła, Primal Knowledge)' : ''}: ${total}.`);
    return true;
  }
  check(f.hp > 0 && !f.incapacitated && !f.unconscious, 'Ta postać nie może teraz działać.');
  check(p?.max, 'Szał jest dostępny tylko dla barbarzyńcy.');
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
      f.rageUses--; state.rageUses = f.rageUses;
      f.rage = { expiresRound: b.round + 1, maxRound: b.round + 100 };
      f.concentration = null; f.concentrationDC = null; f.concentrationChecks = []; state.concentration = null;
      const feet = body.feet ?? 0;
      check(Number.isInteger(feet) && feet >= 0 && feet <= (p.instinctivePounce ? Math.floor(f.speed / 2) : 0), 'Przekroczono ruch Instinctive Pounce.');
      f.pounceMoved = feet;
      if (feet) log(b, `${f.name}: Instinctive Pounce — ${feet} stóp (dodatkowy ruch przy aktywacji).`);
    }
    f.bonus = body.kind === 'rage' ? 'Szał' : 'Przedłużenie Szału';
    f.rageRecoveryOffered = false;
  }
  saveResources(db, f.characterId, state);
  const labels = { rage: 'Szał aktywowany', 'rage-extend': 'Szał przedłużony', 'rage-end': 'Szał zakończony', 'rage-recover': 'Persistent Rage — użycia odzyskane' };
  log(b, `${f.name}: ${labels[body.kind]}; użycia Szału ${f.rageUses}/${p.max}.`);
  return true;
}
