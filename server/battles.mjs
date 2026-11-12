import { handleWarlock, syncHex, reflectThoughtShield, luckBonus } from './warlock-features.mjs';
import { warlockProfile, warlockResistance, bondAdvantage, hexActive, damageTypeName } from '../shared/warlock.mjs';
import { psiResources, handlePsi, psionicStrike } from './psi-warrior.mjs';
import { handlePaladin, syncDivineSense, activateVow, syncVows, vowAttackAdvantage } from './paladin.mjs';
import { handleDruid, syncWildShapes, applyWildShape } from './druid.mjs';
import { handleFiend, recordFiendDefeats } from './warlock.mjs';
import { druidProfile, druidForms, eligibleDruidForms } from '../shared/druid.mjs';
import { handleFighter, prepareSurgeAction, finishSurgeAction } from './fighter.mjs';
import { rageProfile, barbarianResistance, barbarianAttackAdvantage, wolfAttackAdvantage, frenzyDice } from '../shared/barbarian.mjs';
import { handleBarbarian, syncRage, extendRage, endRage, recordAttackRoll } from './barbarian.mjs';
import { randomUUID } from 'node:crypto';
import { statisticsSummary } from './statistics-summary.mjs';
import { emptyStatistics } from './statistics.mjs';
import { characterTraits } from '../shared/character-traits.mjs';
import { fightingStyleAttackBonus, fightingStyleDamageBonus, unarmedStrikeProfile } from '../shared/fighting-style.mjs';
import { publicCaster, resourceState, saveResources, secondWindMaximum, speciesResourceState, proficiencyBonus } from './spell-resources.mjs';
import { handleCombatSpell } from './spell-combat.mjs';

const int = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;
const requireValue = (ok, message) => { if (!ok) throw new Error(message); };
const fresh = f => {
  if (f.shieldAC) { f.ac -= f.shieldAC; f.shieldAC = 0; }
  return Object.assign(f, { action: '', bonus: '', reaction: '', reactionDeferred: false, moved: 0, pounceMoved: 0, extraMove: 0, attacksLeft: 0, usedWeapons: [], lightExtraUsed: false, dodge: false, attackRollMade: false, recklessActive: false, frenzyUsed: false, disengaged: false, psiStrikeUsed: false, psiReduction: 0, actionSurgeUsedThisTurn: false, surgeAction: null, surgeAttacksLeft: 0, lastAbilityCheck: null });
};
const clearProtection = (b, protectorId) => b.fighters.forEach(f => {
  if (Array.isArray(f.protectedBy)) {
    f.protectedBy = f.protectedBy.filter(id => id !== protectorId);
    f.attackDisadvantage = f.protectedBy.length > 0;
  }
});
const log = (b, message) => { b.log = [...b.log, message].slice(-100); };
const decode = row => row ? JSON.parse(row.data) : null;
const statsFor = (db, id) => decode(db.prepare('SELECT data FROM character_statistics WHERE character_id = ?').get(id)) ?? emptyStatistics();
function characterFighter(db, sessionId, memberId) {
  const c = db.prepare(`SELECT c.*, m.id AS memberId FROM characters c JOIN game_members m ON m.character_id = c.id
    JOIN session_participants p ON p.member_id = m.id WHERE p.session_id = ? AND m.id = ? AND m.status = 'accepted'`).get(sessionId, memberId);
  requireValue(c, 'Wybrana postać nie uczestniczy w sesji.');
  const stats = statsFor(db, c.id);
  const equipment = db.prepare(`SELECT i.equipped, a.category AS armorCategory, a.armor_class AS armorClass, a.strength,
    a.stealth_disadvantage AS stealthDisadvantage FROM character_items i JOIN armor_catalog a ON a.id = i.armor_id WHERE i.character_id = ?`).all(c.id);
  const s = statisticsSummary(c, stats, equipment);
  requireValue(s.hp !== null && s.maxHp !== null && s.ac !== null, `Uzupełnij PW i KP postaci ${c.name} przed walką.`);
  const traits = characterTraits(c, stats);
  const attacks = [];
  const equippedWeapons = db.prepare(`SELECT i.id AS itemId, i.slot, i.grip, w.* FROM character_items i JOIN weapon_catalog w ON w.id = i.weapon_id WHERE i.character_id = ? AND i.equipped = 1`).all(c.id)
    .map(item => ({ ...item, properties: JSON.parse(item.properties) }));
  for (const item of equippedWeapons) {
    const properties = item.properties;
    const finesse = properties.some(p => p.startsWith('finezyjna'));
    const strength = s.abilities.str.modifier, dex = s.abilities.dex.modifier;
    const mod = finesse ? Math.max(strength ?? -99, dex ?? -99) : item.type === 'dystansowa' ? dex : strength;
    if (mod == null || mod === -99) continue;
    const proficient = traits.weapons.some(v => {
      const text = v.toLowerCase();
      return text.includes(item.category) && (item.category !== 'martial' || !text.includes('that have')
        || text.includes('finesse') && properties.includes('finezyjna') || text.includes('light') && properties.includes('lekka'));
    });
    const versatile = item.grip === 'two' ? properties.find(p => p.startsWith('wszechstronna'))?.match(/(\d+)d(\d+)/) : null;
    const dice = versatile ?? item.damage.match(/(\d+)d(\d+)/);
    const offHand = item.slot === 'off-hand';
    const weapon = { ...item, properties };
    const weaponDamageBonus = offHand ? Math.min(0, mod) + (dice ? 0 : Number(item.damage) || 0) : mod + (dice ? 0 : Number(item.damage) || 0);
    attacks.push({ ability: finesse ? (strength >= dex ? 'str' : 'dex') : item.type === 'dystansowa' ? 'dex' : 'str', finesse, strengthBonus: strength == null ? null : strength + (proficient ? s.proficiency : 0) + fightingStyleAttackBonus(stats.choices?.fightingStyle, weapon), strengthDamageBonus: (offHand ? Math.min(0, strength) : strength) + (dice ? 0 : Number(item.damage) || 0) + fightingStyleDamageBonus(stats.choices?.fightingStyle, weapon, equippedWeapons, strength ?? 0), id: String(item.itemId), name: item.name, bonus: mod + (proficient ? s.proficiency : 0) + fightingStyleAttackBonus(stats.choices?.fightingStyle, weapon), dice: dice ? Number(dice[1]) : 0,
      sides: dice ? Number(dice[2]) : 0, damageBonus: weaponDamageBonus + fightingStyleDamageBonus(stats.choices?.fightingStyle, weapon, equippedWeapons, mod), type: item.damage_type,
      light: properties.includes('lekka'), offHand, nick: item.mastery === 'Nick' && (stats.choices?.weaponMastery ?? []).includes(item.id), disadvantage: Boolean(s.d20StrengthDexDisadvantage || (properties.includes('ciężka') && (stats.values[item.type === 'dystansowa' ? 'dex' : 'str'] ?? 0) < 13)) });
  }
  if (s.abilities.str.modifier !== null) {
    const unarmed = unarmedStrikeProfile(stats.choices?.fightingStyle, equippedWeapons, equipment.some(item => item.equipped && item.armorCategory === 'shield'), s.abilities.str.modifier, traits.feats.includes('Tavern Brawler'));
    attacks.push({ id: 'unarmed', ability: 'str', name: 'Cios bez broni', bonus: s.abilities.str.modifier + s.proficiency, ...unarmed, type: 'obuchowe', light: false });
  }
  const baseClass = c.class.split(' ')[0];
  const maxAttacks = baseClass === 'Fighter' || c.class.includes('Fighter') ? c.level >= 20 ? 4 : c.level >= 11 ? 3 : c.level >= 5 ? 2 : 1
    : /Barbarian|Monk|Paladin|Ranger/.test(c.class) && c.level >= 5 ? 2 : 1;
  const secondWindMax = secondWindMaximum(c);
  const resources = resourceState(db, c.id);
  const speciesResources = speciesResourceState(db, c.id, c);
  const fighter = fresh({ id: randomUUID(), name: c.name, memberId, characterId: c.id, ownerId: c.user_id, level: c.level, hp: s.hp, maxHp: s.maxHp, tempHp: s.tempHp ?? 0,
    ac: s.ac, speed: s.speed ?? 0, saves: s.savingThrows, notes: '', attacks, maxAttacks, concentration: resourceState(db, c.id).concentration ?? null,
    divineSense: resources.divineSense?.expiresAt > Date.now() ? resources.divineSense : null,
    wildShapeUses: Math.min(druidProfile(c).max, resources.wildShapeUses ?? druidProfile(c).max), wildCompanion: resources.wildCompanion ?? null,
    rageProfile: rageProfile(c), rageUses: Math.min(rageProfile(c).max, resources.rageUses ?? rageProfile(c).max), relentlessRageDC: resources.relentlessRageDC ?? 10, rageRecoveryOffered: rageProfile(c).persistent && resources.persistentRageAvailable !== false,
    ...psiResources(c, resources), psiInt: s.abilities.int.modifier,
    secondWindUses: secondWindMax ? Math.min(secondWindMax, resources.secondWindUses ?? secondWindMax) : 0, secondWindMax,
    actionSurgeMax: secondWindMax && c.level >= 2 ? 1 : 0, actionSurgeUses: secondWindMax && c.level >= 2 ? Math.min(1, resources.actionSurgeUses ?? 1) : 0,
    adrenalineRushUses: speciesResources.adrenalineRushUses, adrenalineRushMax: speciesResources.maxAdrenalineRush,
    relentlessEnduranceAvailable: speciesResources.relentlessEnduranceAvailable,
    breathWeaponUses: speciesResources.breathWeaponUses, breathWeaponMax: speciesResources.maxBreathWeapon,
    breathWeaponDamage: speciesResources.breathWeaponDamage, breathWeaponType: speciesResources.breathWeaponType,
    breathWeaponDC: speciesResources.maxBreathWeapon && s.abilities.con.modifier !== null ? 8 + s.abilities.con.modifier + s.proficiency : null,
    goliathAncestry: speciesResources.goliathAncestry, giantAncestryUses: speciesResources.giantAncestryUses, giantAncestryMax: speciesResources.maxGiantAncestry,
    largeFormAvailable: speciesResources.largeFormAvailable,
    warlockResistance: warlockProfile(c, stats.values.cha, resources).resistance, thoughtShield: warlockProfile(c, stats.values.cha, resources).thoughtShield, warlockBond: warlockProfile(c, stats.values.cha, resources).awakenedMind, hex: resources.hex?.expiresAt > Date.now() && resources.concentration === resources.hex.name ? { ...resources.hex, defeatedRound: resources.hex.targetDefeated ? 0 : resources.hex.defeatedRound } : null,
    damageResistance: traits.ancestry?.damageType ?? traits.fiendishLegacy?.damageType ?? null,
    draconicFlightAvailable: speciesResources.draconicFlightAvailable,
    protectionAvailable: stats.choices?.fightingStyle === 'protection' && equipment.some(item => item.equipped && item.armorCategory === 'shield'),
    deathSuccesses: s.deathSuccesses ?? 0, deathFailures: s.deathFailures ?? 0 });
  const form = druidForms.find(form => form.id === resources.wildShape?.formId);
  if (druidProfile(c).max && form && eligibleDruidForms(c).some(f => f.id === form.id) && resources.wildShape.expiresAt > Date.now()) applyWildShape(fighter, form, c, stats, resources.wildShape);
  return fighter;
}
function persistVitals(db, f) {
  if (!f.characterId) return;
  const stats = statsFor(db, f.characterId);
  Object.assign(stats.values, { hp: f.hp, tempHp: f.tempHp, deathSuccesses: f.deathSuccesses, deathFailures: f.deathFailures });
  db.prepare(`INSERT INTO character_statistics (character_id, data) VALUES (?, ?)
    ON CONFLICT(character_id) DO UPDATE SET data = excluded.data`).run(f.characterId, JSON.stringify(stats));
}
function damage(db, f, amount, critical = false, damageType = null) {
  amount = Math.max(0, amount - (f.psiReduction ?? 0)); f.psiReduction = 0;
  if (damageType && (f.damageResistance === damageType || warlockResistance(f, damageType) || barbarianResistance(f, damageType))) amount = Math.floor(amount / 2);
  f.damageTaken = (f.damageTaken ?? Math.max(0, f.maxHp - f.hp)) + amount;
  const before = f.hp;
  const absorbed = Math.min(f.tempHp, amount);
  f.tempHp -= absorbed;
  const remaining = amount - absorbed;
  const excess = Math.max(0, remaining - before);
  f.lastDamage = { amount, hpBefore: before, tempHpAbsorbed: absorbed, hpLost: Math.min(before, remaining), excess };
  f.overkillDamage = (f.overkillDamage ?? 0) + excess;
  f.hp = Math.max(0, f.hp - remaining);
  if (f.characterId && before > 0 && f.hp === 0 && f.relentlessEnduranceAvailable && excess < f.maxHp) {
    f.hp = 1;
    f.relentlessEnduranceAvailable = false;
    const state = resourceState(db, f.characterId);
    state.relentlessEnduranceAvailable = false;
    saveResources(db, f.characterId, state);
    f.lastDamage.relentlessEndurance = true;
  }
  if (f.characterId && before > 0 && f.hp === 0) { f.deathSuccesses = 0; f.deathFailures = 0; }
  if (f.characterId && amount > 0 && before === 0) {
    if (f.deathSuccesses >= 3) { f.deathSuccesses = 0; f.deathFailures = 0; }
    f.deathFailures = Math.min(3, f.deathFailures + (critical ? 2 : 1));
  }
  if (f.characterId && remaining - before >= f.maxHp) f.deathFailures = 3;
  if (f.hp === 0) {
    f.dodge = false;
    if (before > 0 && f.rage && f.rageProfile?.relentless && f.deathFailures < 3 && f.saves.con != null) f.relentlessRagePending = { dc: f.relentlessRageDC ?? 10 };
    else endRage(f);
  }
  if (f.concentration && amount > 0) {
    if (f.hp === 0) {
      f.concentration = null; f.concentrationDC = null; f.concentrationChecks = [];
      if (f.characterId) { const state = resourceState(db, f.characterId); state.concentration = null; saveResources(db, f.characterId, state); }
    } else {
      f.concentrationChecks = [...(f.concentrationChecks ?? (f.concentrationDC ? [f.concentrationDC] : [])), Math.min(30, Math.max(10, Math.floor(amount / 2)))];
      f.concentrationDC = f.concentrationChecks[0];
    }
  }
  persistVitals(db, f);
}
const activeMember = (db, sessionId, f) => !f.characterId || Boolean(db.prepare(`SELECT 1 FROM session_participants p JOIN game_members m ON m.id = p.member_id
  WHERE p.session_id = ? AND p.member_id = ? AND m.character_id = ? AND m.status = 'accepted'`).get(sessionId, f.memberId, f.characterId));

function removeDeadMonsters(b) {
  const previous = b.fighters;
  const dead = previous.filter(f => !f.characterId && f.hp <= 0);
  if (!dead.length) return;
  const oldTurn = b.turn, current = previous[oldTurn];
  b.defeatedMonsters = [...(b.defeatedMonsters ?? []), ...dead.map(f => ({ id: f.id, name: f.name, damageTaken: f.damageTaken ?? Math.max(0, f.maxHp - f.hp), overkillDamage: f.overkillDamage ?? 0, lastDamage: f.lastDamage ?? null }))];
  for (const f of dead) log(b, `${f.name} umiera i opuszcza pole bitwy.`);
  b.fighters = previous.filter(f => f.characterId || f.hp > 0);
  if (b.pending && dead.some(f => f.id === b.pending.actorId || f.id === b.pending.targetId)) b.pending = null;
  if (!b.fighters.length) { b.active = false; b.turn = 0; log(b, 'Walka zakończona: brak uczestników na polu bitwy.'); return; }
  const currentIndex = b.fighters.findIndex(f => f.id === current.id);
  if (currentIndex >= 0) { b.turn = currentIndex; return; }
  // If the current monster died, start the next surviving participant's turn.
  let nextIndex = (oldTurn + 1) % previous.length;
  while (!b.fighters.some(f => f.id === previous[nextIndex].id)) nextIndex = (nextIndex + 1) % previous.length;
  if (nextIndex <= oldTurn) b.round++;
  b.turn = b.fighters.findIndex(f => f.id === previous[nextIndex].id);
  fresh(b.fighters[b.turn]);
  log(b, `Runda ${b.round}: tura ${b.fighters[b.turn].name}.`);
}

export function handleBattles(db, user, path, method, body, send) {
  const route = path.match(/^\/api\/games\/([1-9]\d*)\/battle(?:\/(start|act|next|end))?$/);
  if (!route) return false;
  const reply = (status, data) => { send(status, data); return true; };
  const gameId = Number(route[1]), action = route[2];
  const game = db.prepare('SELECT * FROM games WHERE id = ?').get(gameId);
  const gm = game && user.role === 'gm' && game.gm_id === user.id;
  const session = db.prepare('SELECT id FROM game_sessions WHERE game_id = ? AND ended_at IS NULL').get(gameId);
  if (!game || !session) return reply(404, { error: 'Ta sesja gry nie jest aktywna.' });
  const participating = db.prepare(`SELECT 1 FROM session_participants p JOIN game_members m ON m.id = p.member_id JOIN characters c ON c.id = m.character_id
    WHERE p.session_id = ? AND c.user_id = ? AND m.status = 'accepted'`).get(session.id, user.id);
  if (!gm && !participating) return reply(404, { error: 'Nie masz dostępu do tej walki.' });
  if ((!action && method !== 'GET') || (action && method !== 'POST')) return reply(405, { error: 'Niedozwolona metoda.' });
  let battle = decode(db.prepare('SELECT data FROM session_battles WHERE session_id = ?').get(session.id));
  const canControl = f => f.characterId ? f.ownerId === user.id : gm;
  const response = () => ({
    battle: battle ? { ...battle,
      defeatedMonsters: gm ? battle.defeatedMonsters : battle.defeatedMonsters?.map(f => ({ id: f.id, name: f.name, damageTaken: f.damageTaken })),
      fighters: battle.fighters.map(f => !gm && !f.characterId ? {
        id: f.id, name: f.name, hidden: true, attackDisadvantage: Boolean(f.dodge),
        damageTaken: f.damageTaken ?? Math.max(0, f.maxHp - f.hp),
      } : { ...f, divineSense: f.divineSense?.expiresAt > Date.now() && f.hp > 0 && !f.incapacitated && !f.unconscious && !(f.deathFailures >= 3) ? f.divineSense : null, ...(f.characterId && (gm || f.ownerId === user.id) ? { spellcasting: publicCaster(db, f.characterId) } : {}) }),
      pending: !gm && battle.pending && !battle.fighters.find(f => f.id === battle.pending.actorId)?.characterId
        ? { kind: 'waiting', actorId: battle.pending.actorId } : !gm && battle.pending?.kind === 'spell'
          ? { ...battle.pending, targets: battle.pending.targets.map(({ multiplier, ...target }) => target) } : battle.pending,
      suspendedAction: undefined,
      // Also hide armor classes in log entries saved by earlier versions.
      log: battle.log.map(entry => {
        const clean = entry.replace(/ vs KP -?\d+/g, '');
        if (!gm && [...battle.fighters.filter(f => !f.characterId), ...(battle.defeatedMonsters ?? [])].some(f => clean.startsWith(`${f.name} → `))) {
          return clean.replace(/: \d+ \+ -?\d+:/, ':');
        }
        return clean;
      }),
    } : null,
    gm: Boolean(gm), controlledIds: battle?.fighters.filter(f => activeMember(db, session.id, f) && canControl(f)).map(f => f.id) ?? [],
  });
  if (!action) return reply(200, response());
  db.exec('SAVEPOINT battle_action');
  try {
    const hpBefore = new Map((battle?.fighters ?? []).map(f => [f.id, f.hp]));
    const damageSourceId = ['damage', 'spell-effect', 'resolve'].includes(body.kind) ? battle?.pending?.actorId ?? null : null;
    requireValue(body.sessionId === session.id, 'Sesja zmieniła się. Odśwież widok.');
    requireValue(body.version === (battle?.version ?? 0), 'Walka została zaktualizowana. Odświeżono widok; powtórz wybór.');
    if (action === 'start') {
      requireValue(gm && !battle?.active, 'Tylko GM może rozpocząć nową walkę, gdy inna nie trwa.');
      requireValue(Array.isArray(body.fighters) && body.fighters.length >= 2 && body.fighters.length <= 50, 'Wybierz od 2 do 50 uczestników.');
      const seen = new Set();
      const fighters = body.fighters.map(entry => {
        requireValue(int(entry.initiative, -99, 99), 'Podaj inicjatywę każdego uczestnika.');
        let f;
        if (entry.memberId) {
          requireValue(!seen.has(entry.memberId), 'Postać może wystąpić w walce tylko raz.'); seen.add(entry.memberId);
          f = characterFighter(db, session.id, entry.memberId);
        } else {
          const m = db.prepare('SELECT * FROM game_monster_entries WHERE game_id = ? AND id = ?').get(gameId, entry.enemyId);
          requireValue(m, 'Nie znaleziono potwora w katalogu gry.');
          f = fresh({ id: randomUUID(), name: m.name, hp: m.hp, maxHp: m.hp, tempHp: 0, ac: m.ac, speed: m.speed, saves: JSON.parse(m.saves), notes: m.notes, attacks: [], maxAttacks: 1, deathSuccesses: 0, deathFailures: 0 });
        }
        return { ...f, initiative: entry.initiative };
      }).sort((a, b) => b.initiative - a.initiative);
      battle = { sessionId: session.id, startedAt: Date.now(), version: battle?.version ?? 0, active: true, round: 1, turn: 0, fighters, pending: null, log: ['Walka rozpoczęta.'] };
    } else {
      requireValue(battle?.active, 'Walka nie trwa.');
      const b = battle, current = b.fighters[b.turn];
      syncRage(db, b);
      syncWildShapes(db, b);
      syncDivineSense(db, b);
      requireValue(!b.fighters.some(f => f.relentlessRagePending) || action === 'act' && body.kind === 'relentless-rage', 'Najpierw rozstrzygnij Relentless Rage.');
      if (action === 'end') { requireValue(gm, 'Tylko GM może zakończyć walkę.'); requireValue(!b.fighters.some(f => f.concentrationDC), 'Najpierw rozstrzygnij rzuty koncentracji.'); b.active = false; b.pending = null; b.suspendedAction = null; log(b, 'GM zakończył walkę.'); }
      else if (action === 'next') {
        b.fighters.forEach(f => { f.lastAbilityCheck = null; });
        requireValue(!b.fighters.some(f => f.concentrationDC), 'Najpierw rozstrzygnij rzuty koncentracji.');
        requireValue(gm || (current.ownerId === user.id && activeMember(db, session.id, current)), 'To nie jest twoja tura.');
        requireValue(!b.pending || gm, 'Najpierw rozstrzygnij rozpoczęte działanie.');
        b.pending = null;
        b.suspendedAction = null;
        if (current.mockery && current.mockery.expiresRound <= b.round) current.mockery = null;
        if (current.rage && !current.rageProfile.persistent && b.round >= current.rage.expiresRound) { endRage(current); log(b, `${current.name}: Szał wygasł.`); }
        current.rageRecoveryOffered = false;
        b.slotCasters = [];
        if (++b.turn === b.fighters.length) { b.turn = 0; b.round++; }
        clearProtection(b, b.fighters[b.turn].id);
        fresh(b.fighters[b.turn]); log(b, `Runda ${b.round}: tura ${b.fighters[b.turn].name}.`);
      } else {
        const kind = body.kind;
        syncVows(b);
        if (kind !== 'tactical-mind') b.fighters.forEach(f => { f.lastAbilityCheck = null; });
        const surgeState = prepareSurgeAction(b, body, canControl);
        if (handleWarlock({ db, b, body, gm, canControl, activeMember, log })) {
          // Warlock features persist in this battle transaction.
        } else if (handleFiend({ db, b, body, gm, activeMember, persistVitals, log })) {
          // Nearby defeats require GM confirmation because the battle has no positions.
        } else if (handlePsi({ db, b, body, canControl, activeMember, log })) {
          // Psionic resources share the battle transaction.
        } else if (handleFighter({ db, b, body, canControl, activeMember, log })) {
          // Fighter resources use the same transaction as the battle.
        } else if (handlePaladin({ db, b, body, canControl, activeMember, persistVitals, log })) {
          // Paladin resources share the battle transaction.
        } else if (handleDruid({ db, b, body, canControl, activeMember, persistVitals, log })) {
          // Druid resources share the battle transaction.
        } else if (handleBarbarian({ db, b, body, gm, canControl, activeMember, persistVitals, log })) {
          // Barbarian actions share the battle transaction.
        } else if (handleCombatSpell({ db, user, gm, b, body, canControl, activeMember, damage, persistVitals, log })) {
          // The spell handler shares this action's SQL savepoint and cloud commit.
        } else if (kind === 'resolve') {
          requireValue(gm && (!b.pending || b.pending.kind === 'request' && !b.pending.warlockBond), 'Najpierw rozlicz trafienie.');
          requireValue(typeof body.note === 'string' && body.note.trim() && body.note.length <= 1000, 'Opisz rozstrzygnięcie.');
          if (body.targetId) {
            const target = b.fighters.find(f => f.id === body.targetId);
            requireValue(target && int(body.amount, 0, 9999) && ['damage', 'heal'].includes(body.effect), 'Wybierz cel, efekt i wartość.');
            if (body.effect === 'damage') {
              damage(db, target, body.amount, false, body.damageType ?? null);
              if (target.thoughtShield && damageTypeName(body.damageType) === 'psychiczne' && target.lastDamage.amount > 0) {
                const source = b.fighters.find(f => f.id === body.sourceId);
                requireValue(source && source.id !== target.id, 'Thought Shield: wskaż sprawcę obrażeń psychicznych.');
                reflectThoughtShield(db, b, target, source, body.damageType, target.lastDamage.amount, damage, log);
              }
            }
            else { requireValue(target.deathFailures < 3, 'Zwykłe leczenie nie przywraca życia.'); target.hp = Math.min(target.maxHp, target.hp + body.amount); if (target.hp > 0) { target.deathFailures = 0; target.deathSuccesses = 0; } persistVitals(db, target); }
          }
          log(b, `GM: ${body.note}${body.targetId ? ` (${body.effect === 'damage' ? 'obrażenia' : 'leczenie'}: ${body.amount})` : ''}`); b.pending = null;
        } else {
          const actor = (kind === 'request' && body.slot === 'reaction' || kind === 'protection') ? b.fighters.find(f => f.id === body.actorId) : current;
          requireValue(!b.fighters.some(f => f.concentrationDC), 'Najpierw rozstrzygnij rzuty koncentracji.');
          requireValue(actor && activeMember(db, session.id, actor) && canControl(actor), 'Nie możesz sterować tym uczestnikiem.');
          if (kind === 'death') {
            requireValue(!b.pending && actor.characterId && actor.hp === 0 && actor.deathFailures < 3 && actor.deathSuccesses < 3 && !actor.action, 'Rzut przeciw śmierci jest teraz niedostępny.');
            requireValue(int(body.roll, 1, 20), 'Podaj wynik k20 (1–20).');
            const luck = luckBonus(db, actor.characterId, body.luckRoll);
            if (body.roll === 20) { actor.hp = 1; actor.deathSuccesses = 0; actor.deathFailures = 0; }
            else if (body.roll !== 1 && body.roll + luck >= 10) actor.deathSuccesses = Math.min(3, actor.deathSuccesses + 1);
            else actor.deathFailures = Math.min(3, actor.deathFailures + (body.roll === 1 ? 2 : 1));
            actor.action = body.roll === 20 ? '' : 'Rzut przeciw śmierci'; persistVitals(db, actor); log(b, `${actor.name}: rzut przeciw śmierci ${body.roll}.`);
          } else {
            requireValue(actor.hp > 0 && actor.deathFailures < 3 && !actor.incapacitated && !actor.unconscious, 'Ten uczestnik nie może teraz działać.');
            if (kind === 'protection') {
              requireValue(!b.pending && actor.protectionAvailable && !actor.reaction && body.targetId, 'Protection wymaga dostępnej reakcji, tarczy i wybranego celu.');
              const target = b.fighters.find(f => f.id === body.targetId);
              requireValue(target && target.id !== actor.id && target.hp > 0 && target.deathFailures < 3, 'Wybierz pobliski cel Protection.');
              actor.reaction = 'Protection';
              target.protectedBy = [...(target.protectedBy ?? []), actor.id];
              target.attackDisadvantage = true;
              log(b, `${actor.name}: Protection chroni ${target.name} do początku następnej tury.`);
            } else if (kind === 'damage') {
              const p = b.pending;
              requireValue(p?.kind === 'damage' && p.actorId === actor.id, 'Brak trafienia do rozliczenia.');
              const count = p.attack.dice * (p.critical ? 2 : 1);
              requireValue(Array.isArray(body.rolls) && body.rolls.length === count && body.rolls.every(n => int(n, 1, p.attack.sides)), 'Podaj wynik każdej kości obrażeń.');
              const frenzyCount = (p.frenzyDice ?? 0) * (p.critical ? 2 : 1);
              requireValue(!frenzyCount || Array.isArray(body.frenzyRolls) && body.frenzyRolls.length === frenzyCount && body.frenzyRolls.every(n => int(n, 1, 6)), 'Podaj wyniki wszystkich kosci k6 Frenzy.');
              const frenzyDamage = frenzyCount ? body.frenzyRolls.reduce((sum, n) => sum + n, 0) : 0;
              const amount = Math.max(0, frenzyDamage + body.rolls.reduce((sum, n) => sum + n, 0) + p.attack.damageBonus);
              const target = b.fighters.find(f => f.id === p.targetId);
              damage(db, target, amount, p.critical, p.attack.type);
              reflectThoughtShield(db, b, target, actor, p.attack.type, target.lastDamage.amount, damage, log);
              if (hexActive(actor, target)) {
                const hexCount = p.critical ? 2 : 1;
                requireValue(Array.isArray(body.hexRolls) && body.hexRolls.length === hexCount && body.hexRolls.every(n => int(n, 1, 6)), 'Hex: podaj dodatkowe k6 (dwie przy trafieniu krytycznym).');
                damage(db, target, body.hexRolls.reduce((sum, n) => sum + n, 0), false, actor.hex.damageType ?? 'nekrotyczne');
                reflectThoughtShield(db, b, target, actor, actor.hex.damageType ?? 'nekrotyczne', target.lastDamage.amount, damage, log);
              }
              psionicStrike(db, b, actor, body, amount, damage, target, log); log(b, `${actor.name} → ${target.name}: ${amount} obrażeń (${p.attack.type}).`); b.pending = null;
            } else {
              requireValue(!b.pending, 'Najpierw rozstrzygnij rozpoczęte działanie.');
              if (kind === 'move') {
                requireValue(int(body.feet, 1, 999) && actor.moved + body.feet <= actor.speed + actor.extraMove, 'Przekroczono dostępny ruch.');
                actor.moved += body.feet; log(b, `${actor.name}: ruch ${body.feet} stóp.`);
              } else if (kind === 'attack') {
                const slot = body.slot;
                requireValue(['action', 'bonus'].includes(slot), 'Wybierz akcję lub akcję bonusową.');
                let attack = actor.attacks.find(a => a.id === body.attackId);
                if (!actor.characterId) {
                  requireValue(gm && body.attack && typeof body.attack.name === 'string' && body.attack.name.trim() && body.attack.name.length <= 80 && int(body.attack.bonus, -30, 40)
                    && int(body.attack.dice, 0, 20) && int(body.attack.sides, 0, 100) && (body.attack.dice === 0 || body.attack.sides >= 2) && int(body.attack.damageBonus, -30, 100), 'Podaj parametry ataku potwora.');
                  requireValue(body.attack.type == null || typeof body.attack.type === 'string' && body.attack.type.length <= 40, 'Podaj typ obrażeń.');
                  attack = { ...body.attack, type: body.attack.type || 'wg opisu potwora', ability: null, light: false };
                }
                requireValue(attack, 'Wybierz dostępną broń.');
                if (body.ability === 'str') {
                  requireValue(attack.finesse && attack.strengthBonus != null, 'Ta broń nie pozwala wybrać Siły.');
                  attack = { ...attack, ability: 'str', bonus: attack.strengthBonus, damageBonus: attack.strengthDamageBonus };
                }
                if (slot === 'bonus') {
                  requireValue(actor.characterId, 'Atak bonusowy potwora wymaga konkretnej zdolności. Rozstrzygnij ją jako zdolność specjalną GM.');
                  requireValue(!actor.bonus && attack.offHand && attack.light && actor.usedWeapons.some(id => id !== attack.id && actor.attacks.find(a => a.id === id)?.light), 'Brak dostępnego ataku bonusowego inną lekką bronią.');
                  requireValue(!actor.lightExtraUsed, 'Dodatkowy atak Light został już wykorzystany.');
                  actor.lightExtraUsed = true;
                  actor.bonus = 'Atak';
                } else {
                  const nickExtra = !actor.lightExtraUsed && attack.nick && attack.light && attack.offHand
                    && actor.usedWeapons.some(id => id !== attack.id && actor.attacks.find(a => a.id === id)?.light);
                  requireValue(!actor.action || actor.action === 'Atak' && (actor.attacksLeft > 0 || nickExtra), 'Akcja została wykorzystana.');
                  if (!actor.action) actor.attacksLeft = actor.maxAttacks;
                  actor.action = 'Atak';
                  if (nickExtra) actor.lightExtraUsed = true;
                  else actor.attacksLeft--;
                  actor.usedWeapons.push(attack.id);
                }
                const target = b.fighters.find(f => f.id === body.targetId);
                requireValue(target && target.id !== actor.id && target.deathFailures < 3, 'Wybierz cel ataku.');
                if (body.vowTargetId != null) {
                  requireValue(slot === 'action' && actor.usedWeapons.length === 1, 'Vow of Enmity aktywuj przy rozpoczęciu akcji Atak.');
                  activateVow(db, b, actor, body.vowTargetId);
                  log(b, `${actor.name}: Vow of Enmity (1 minuta; zasięg i widoczność potwierdza GM).`);
                }
                if (actor.rage && attack.ability === 'str') attack = { ...attack, damageBonus: attack.damageBonus + actor.rageProfile.damage };
                if (Boolean(actor.characterId) !== Boolean(target.characterId)) extendRage(b, actor);
                const disadvantage = Boolean(attack.disadvantage || bondAdvantage(target, actor) || target.dodge || target.attackDisadvantage || body.disadvantage || actor.mockery);
                recordAttackRoll(b, actor, body, log);
                const advantage = Boolean(body.advantage || bondAdvantage(actor, target) || vowAttackAdvantage(actor, target) || barbarianAttackAdvantage(actor, target, attack.ability) || wolfAttackAdvantage(b, actor, target));
                requireValue(int(body.roll, 1, 20) && (disadvantage === advantage || int(body.roll2, 1, 20)), 'Podaj wynik k20; przy ułatwieniu lub utrudnieniu podaj dwie kości.');
                const roll = disadvantage === advantage ? body.roll : disadvantage ? Math.min(body.roll, body.roll2) : Math.max(body.roll, body.roll2);
                actor.mockery = null;
                const hit = roll !== 1 && (roll === 20 || roll + attack.bonus >= target.ac);
                log(b, `${actor.name} → ${target.name}: ${roll} + ${attack.bonus}: ${hit ? roll === 20 ? 'trafienie krytyczne' : 'trafienie' : 'pudło'}.`);
                const frenzy = hit ? frenzyDice(b, actor, attack.ability) : 0;
                if (frenzy) actor.frenzyUsed = true;
                if (hit) b.pending = { kind: 'damage', actorId: actor.id, targetId: target.id, attack, frenzyDice: frenzy, critical: roll === 20, attackTotal: roll + attack.bonus };
              } else if (kind === 'second-wind') {
                requireValue(actor.characterId && actor.secondWindMax > 0, 'Drugi oddech jest dostępny tylko dla wojownika.');
                requireValue(body.slot === 'bonus', 'Drugi oddech wymaga akcji bonusowej.');
                requireValue(!actor.bonus, 'Akcja bonusowa została już wykorzystana.');
                requireValue(actor.hp > 0 && actor.hp < actor.maxHp, 'Drugi oddech nie jest teraz potrzebny.');
                requireValue(actor.secondWindUses > 0, 'Brak dostępnych użyć Drugiego oddechu.');
                requireValue(int(body.roll, 1, 10), 'Podaj wynik k10 (1–10).');
                const healed = Math.min(actor.maxHp - actor.hp, body.roll + actor.level);
                actor.hp += healed;
                actor.bonus = 'Drugi oddech';
                actor.secondWindUses--;
                const state = resourceState(db, actor.characterId);
                state.secondWindUses = actor.secondWindUses;
                saveResources(db, actor.characterId, state);
                persistVitals(db, actor);
                log(b, `${actor.name}: Drugi oddech przywraca ${healed} PW.`);
              } else if (kind === 'adrenaline-rush') {
                requireValue(actor.characterId && actor.adrenalineRushMax > 0, 'Adrenaline Rush jest dostępne tylko dla Orka.');
                requireValue(body.slot === 'bonus' && !actor.bonus, 'Adrenaline Rush wymaga dostępnej akcji bonusowej.');
                requireValue(actor.adrenalineRushUses > 0, 'Brak dostępnych użyć Adrenaline Rush.');
                actor.bonus = 'Adrenaline Rush';
                actor.extraMove += actor.speed;
                actor.tempHp = proficiencyBonus(actor.level);
                actor.adrenalineRushUses--;
                const state = resourceState(db, actor.characterId);
                state.adrenalineRushUses = actor.adrenalineRushUses;
                saveResources(db, actor.characterId, state);
                persistVitals(db, actor);
                log(b, `${actor.name}: Adrenaline Rush — Zryw i ${proficiencyBonus(actor.level)} tymczasowych PW.`);
              } else if (kind === 'breath-weapon') {
                requireValue(actor.characterId && actor.breathWeaponMax > 0, 'Broń Oddechowa jest dostępna tylko dla Smokowca z wybranym przodkiem.');
                requireValue(body.slot === 'action' && !actor.action, 'Broń Oddechowa wymaga dostępnej akcji.');
                requireValue(actor.breathWeaponUses > 0, 'Brak dostępnych użyć Broni Oddechowej.');
                actor.action = 'Broń Oddechowa';
                extendRage(b, actor);
                actor.breathWeaponUses--;
                const state = resourceState(db, actor.characterId);
                state.breathWeaponUses = actor.breathWeaponUses;
                saveResources(db, actor.characterId, state);
                b.pending = { kind: 'request', actorId: actor.id, slot: 'action', description: `Broń Oddechowa: stożek 15 stóp lub linia 5 × 30 stóp; rzut obronny na ZR lub KON, ST ${actor.breathWeaponDC}; obrażenia ${actor.breathWeaponDamage}k10 (${actor.breathWeaponType}). GM wybiera cele i rozstrzyga obszar.`, breathWeapon: true };
                log(b, `${actor.name}: Broń Oddechowa (${actor.breathWeaponType}), pozostałe użycia: ${actor.breathWeaponUses}.`);
              } else if (kind === 'draconic-flight') {
                requireValue(actor.characterId && actor.draconicFlightAvailable, 'Lot Smoka jest niedostępny.');
                requireValue(body.slot === 'bonus' && !actor.bonus, 'Lot Smoka wymaga dostępnej akcji bonusowej.');
                actor.bonus = 'Lot Smoka';
                actor.flying = true;
                actor.flySpeed = actor.speed;
                actor.draconicFlightAvailable = false;
                const state = resourceState(db, actor.characterId);
                state.draconicFlightAvailable = false;
                saveResources(db, actor.characterId, state);
                log(b, `${actor.name}: Lot Smoka — szybkość lotu ${actor.flySpeed} stóp przez 10 minut.`);
              } else if (kind === 'request') {
                requireValue(['action', 'bonus', 'reaction'].includes(body.slot) && !actor[body.slot], 'Ten rodzaj działania został wykorzystany.');
                requireValue(typeof body.description === 'string' && body.description.trim() && body.description.length <= 1000 && (body.roll == null || int(body.roll, 1, 20)), 'Opisz działanie i ewentualny wynik k20.');
                actor[body.slot] = 'Rozstrzyga GM'; b.pending = { kind: 'request', actorId: actor.id, slot: body.slot, description: body.description, ...(body.roll ? { roll: body.roll } : {}) };
                log(b, `${actor.name}: ${body.description}${body.roll ? ` (k20: ${body.roll})` : ''} — oczekuje na GM.`);
              } else {
                requireValue(['skip', 'dash', 'dodge', 'disengage', 'help'].includes(kind), 'Nieznane działanie.');
                const slot = kind === 'skip' ? body.slot : 'action';
                const skipAttacks = kind === 'skip' && slot === 'action' && actor.action === 'Atak' && actor.attacksLeft > 0;
                requireValue(['action', 'bonus', 'reaction'].includes(slot) && (!actor[slot] || skipAttacks), 'Działanie zostało już wykorzystane.');
                const labels = { skip: 'Pominięto', dash: 'Zryw', dodge: 'Unik', disengage: 'Wycofanie', help: 'Pomoc' };
                if (kind === 'skip' && slot === 'reaction') actor.reactionDeferred = true;
                else actor[slot] = labels[kind];
                if (skipAttacks) actor.attacksLeft = 0;
                if (kind === 'dash') actor.extraMove += actor.speed;
                if (kind === 'dodge') actor.dodge = true;
                if (kind === 'disengage') actor.disengaged = true;
                log(b, `${actor.name}: ${labels[kind]}.`);
              }
            }
          }
        }
        finishSurgeAction(current, surgeState);
      }
    }
    if (battle.active && !battle.pending && battle.suspendedAction) {
      const p = battle.suspendedAction;
      const targetId = p.kind === 'damage' ? p.targetId : p.kind === 'spell' ? p.targets[0]?.id : null;
      const target = battle.fighters.find(f => f.id === targetId);
      if (target?.shieldAC && !p.critical && p.attackTotal != null && p.attackTotal < target.ac) log(battle, `${target.name}: Shield blokuje trafienie.`);
      else battle.pending = p;
      battle.suspendedAction = null;
    }
    syncRage(db, battle);
    syncWildShapes(db, battle);
    syncDivineSense(db, battle);
    syncVows(battle);
    if (action === 'act') recordFiendDefeats({ db, b: battle, before: hpBefore, sourceId: damageSourceId, activeMember, persistVitals, log });
    syncHex(db, battle);
    removeDeadMonsters(battle);
    if (!battle.active && !battle.summary) battle.summary = {
      endedAt: Date.now(), rounds: battle.round,
      defeatedMonsterCount: battle.defeatedMonsters?.length ?? 0,
      remainingMonsterCount: battle.fighters.filter(f => !f.characterId).length,
    };
    if (!battle.pending) battle.fighters.forEach(f => { f.psiReduction = 0; });
    battle.version++;
    db.prepare(`INSERT INTO session_battles (session_id, data) VALUES (?, ?) ON CONFLICT(session_id) DO UPDATE SET data = excluded.data`).run(session.id, JSON.stringify(battle));
    db.exec('RELEASE battle_action');
    return reply(200, response());
  } catch (e) { db.exec('ROLLBACK TO battle_action; RELEASE battle_action'); return reply(409, { error: e.message }); }
}
