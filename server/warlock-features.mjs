import { warlockProfile, resilienceTypes, hexDisadvantage, damageTypeName } from '../shared/warlock.mjs';
import { statisticsSummary } from './statistics-summary.mjs';
import { resourceState, saveResources } from './spell-resources.mjs';
const check = (ok, message) => { if (!ok) throw new Error(message); };
export function warlockData(db, id) {
  const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(id);
  const row = db.prepare('SELECT data FROM character_statistics WHERE character_id = ?').get(id);
  const stats = row ? JSON.parse(row.data) : {};
  const state = resourceState(db, id);
  return { character, state, profile: warlockProfile(character, stats.values?.cha, state) };
}
export function restWarlock(state, rest) {
  state.fiendResilienceEpoch = (state.fiendResilienceEpoch ?? 0) + 1;
  state.clairvoyantUsed = false; state.awakenedMind = null;
  if (rest === 'long') { state.magicalCunningUsed = false; state.contactPatronUsed = false; state.darkLuckSpent = 0; state.darkLuckRolls = []; }
}
export function luckBonus(db, id, roll) {
  if (roll == null) return 0;
  const { state, profile } = warlockData(db, id);
  check(profile.luckRemaining > 0 && Number.isInteger(roll) && roll >= 1 && roll <= 10, 'Dark One’s Own Luck: wymagane dostępne użycie i wynik k10 (1–10).');
  state.darkLuckSpent = (state.darkLuckSpent ?? 0) + 1;
  saveResources(db, id, state);
  return roll;
}
// Outside combat, the caller must verify ownership and the resource version.
export function useWarlockFeature(db, id, body) {
  const { character, state, profile: p } = warlockData(db, id);
  check(p.enabled, 'Wymagana klasa Warlock.');
  if (body.kind === 'dark-ones-own-luck') {
    check(p.luckRemaining > 0 && Number.isInteger(body.luckRoll) && body.luckRoll >= 1 && body.luckRoll <= 10 && typeof body.rollId === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(body.rollId) && !(state.darkLuckRolls ?? []).includes(body.rollId), 'Podaj k10 i nowy identyfikator testu/rzutu; raz na rzut.');
    state.darkLuckSpent = (state.darkLuckSpent ?? 0) + 1;
    state.darkLuckRolls = [...(state.darkLuckRolls ?? []), body.rollId].slice(-100);
  } else if (body.kind === 'magical-cunning') {
    check(p.cunningAvailable && state.pactSpent > 0, 'Magical Cunning niedostępne lub miejsca nie są zużyte.');
    state.pactSpent = Math.max(0, state.pactSpent - (character.level >= 20 ? 4 : Math.ceil((character.level >= 17 ? 4 : character.level >= 11 ? 3 : character.level >= 2 ? 2 : 1) / 2)));
    state.magicalCunningUsed = true;
  } else if (body.kind === 'contact-patron') {
    check(p.contactPatronAvailable && body.confirmed === true, 'Contact Patron wymaga 9. poziomu, wolnego użycia i potwierdzenia czasu rzucania oraz komponentów.');
    state.contactPatronUsed = true;
  } else if (body.kind === 'fiendish-resilience') {
    check(p.resilienceChoiceAvailable && resilienceTypes.includes(body.damageType), 'Fiendish Resilience: wybierz typ poza Force po odpoczynku.');
    state.fiendResistance = body.damageType;
    state.fiendResilienceChosenAt = state.fiendResilienceEpoch ?? 0;
  } else if (body.kind === 'clairvoyant-recover') {
    check(p.clairvoyantCombatant && !p.clairvoyantAvailable && state.pactSpent < (character.level >= 17 ? 4 : character.level >= 11 ? 3 : 2), 'Brak zużytego Clairvoyant Combatant lub wolnego miejsca paktu.');
    state.pactSpent++; state.clairvoyantUsed = false;
  } else if (body.kind === 'awakened-mind') {
    check(p.greatOldOne && p.telepathyMiles !== null && body.confirmed === true && typeof body.targetName === 'string' && body.targetName.trim() && body.targetName.length <= 80, 'Potwierdź widoczny cel do 30 stóp i uzupełnij CHA.');
    state.awakenedMind = { targetName: body.targetName.trim(), expiresAt: Date.now() + character.level * 60000 };
  } else throw new Error('Nieznana zdolność Warlocka.');
  saveResources(db, id, state);
  return { rollBonus: body.kind === 'dark-ones-own-luck' ? body.luckRoll : undefined, contactPatron: body.kind === 'contact-patron' ? { automaticSaveSuccess: true, spellId: 'contact-other-plane', resolution: 'GM' } : undefined };
}
export function handleWarlock({ db, b, body, gm, canControl, activeMember, log }) {
  if (!['awakened-mind', 'clairvoyant-save', 'clairvoyant-recover', 'hex-transfer'].includes(body.kind)) return false;
  if (body.kind === 'clairvoyant-save') {
    const pending = b.pending;
    check(pending?.kind === 'request' && pending.warlockBond, 'Brak rzutu Clairvoyant Combatant.');
    const target = b.fighters.find(f => f.id === pending.targetId);
    const actor = b.fighters.find(f => f.id === pending.actorId);
    check(target && actor && activeMember(db, b.sessionId, target) && canControl(target), 'Rzut wykonuje właściciel celu lub GM potwora.');
    const adv = Boolean(body.advantage), dis = Boolean(body.disadvantage || hexDisadvantage(b, target, 'wis'));
    check(Number.isInteger(body.roll) && body.roll >= 1 && body.roll <= 20 && (adv === dis || Number.isInteger(body.roll2) && body.roll2 >= 1 && body.roll2 <= 20), 'Podaj k20 i ewentualny drugi k20.');
    const roll = adv === dis ? body.roll : adv ? Math.max(body.roll, body.roll2) : Math.min(body.roll, body.roll2);
    check(Number.isFinite(target.saves?.wis), 'Uzupełnij rzut obronny WIS celu.');
    const total = roll + target.saves.wis + (target.characterId ? luckBonus(db, target.characterId, body.luckRoll) : 0);
    const failed = total < pending.dc;
    if (actor.warlockBond?.targetId === target.id && actor.warlockBond.expiresAt > Date.now()) {
      actor.warlockBond.combat = failed;
      const state = resourceState(db, actor.characterId); state.awakenedMind = actor.warlockBond; saveResources(db, actor.characterId, state);
    }
    log(b, `${target.name}: Clairvoyant Combatant — ${failed ? 'porażka' : 'sukces'} (${total}).`);
    b.pending = null;
    return true;
  }
  const f = b.fighters.find(f => f.id === (body.actorId ?? b.fighters[b.turn].id));
  check(f?.characterId && activeMember(db, b.sessionId, f) && canControl(f) && f.hp > 0 && !f.incapacitated && !f.unconscious && !b.pending && !b.fighters.some(t => t.concentrationDC), 'Ta postać nie może teraz użyć zdolności.');
  const { character, state, profile: p } = warlockData(db, f.characterId);
  if (body.kind === 'clairvoyant-recover') { useWarlockFeature(db, f.characterId, body); log(b, `${f.name}: odnowiono Clairvoyant Combatant za miejsce Pact Magic.`); return true; }
  check(f.id === b.fighters[b.turn].id && !f.bonus, 'Wymagana wolna akcja dodatkowa we własnej turze.');
  const target = b.fighters.find(t => t.id === body.targetId);
  check(target && target.id !== f.id && body.confirmed === true, 'Potwierdź cel, widoczność i zasięg z GM.');
  if (body.kind === 'hex-transfer') {
    check(f.hex && f.hex.expiresAt > Date.now() && f.concentration === f.hex.name && f.hex.targetDefeated === true && (f.hex.defeatedRound < b.round || !f.hex.defeatedOnOwnTurn), 'Hex można przenieść dopiero po spadku poprzedniego celu do 0 PW.');
    f.hex.targetId = target.id; f.hex.targetDefeated = false; f.hex.defeatedRound = null; state.hex = f.hex; saveResources(db, f.characterId, state); f.bonus = 'Hex — przeniesienie';
  } else {
    check(p.greatOldOne && p.telepathyMiles !== null, 'Awakened Mind wymaga Great Old One poziomu 3 i CHA.');
    const row = db.prepare('SELECT data FROM character_statistics WHERE character_id = ?').get(f.characterId);
    const dc = statisticsSummary(character, row ? JSON.parse(row.data) : {}).spellDc;
    check(!body.combatant || p.clairvoyantAvailable && Number.isFinite(dc) && Number.isFinite(target.saves?.wis), 'Clairvoyant Combatant niedostępne lub brak WIS celu.');
    f.warlockBond = { targetId: target.id, targetName: target.name, expiresAt: Date.now() + character.level * 60000, combat: false };
    state.awakenedMind = f.warlockBond; f.bonus = 'Awakened Mind';
    if (body.combatant) {
      state.clairvoyantUsed = true;
      b.pending = { kind: 'request', warlockBond: true, actorId: f.id, targetId: target.id, dc, slot: 'bonus', description: `Clairvoyant Combatant: ${target.name} wykonuje rzut obronny WIS.` };
    }
    saveResources(db, f.characterId, state);
  }
  log(b, `${f.name}: ${f.bonus} → ${target.name}.`);
  return true;
}

export function syncHex(db, b) {
  for (const f of b.fighters.filter(f => f.characterId && f.hex)) {
    if (f.concentration !== f.hex.name || f.hex.expiresAt <= Date.now()) {
      delete f.hex;
      const state = resourceState(db, f.characterId); state.hex = null; saveResources(db, f.characterId, state);
      continue;
    }
    const target = b.fighters.find(t => t.id === f.hex.targetId);
    if (target?.hp === 0 && !f.hex.targetDefeated) {
      f.hex.targetDefeated = true; f.hex.defeatedRound = b.round; f.hex.defeatedOnOwnTurn = b.fighters[b.turn].id === f.id;
      const state = resourceState(db, f.characterId); state.hex = f.hex; saveResources(db, f.characterId, state);
    }
  }
}

// Two Thought Shields can reflect back and forth; Psychic resistance halves each
// return, so the chain terminates at zero without applying resistance twice.
export function reflectThoughtShield(db, b, target, source, type, amount, damage, log) {
  if (damageTypeName(type) !== 'psychiczne') return;
  let origin = target, receiver = source, incoming = amount;
  while (origin.thoughtShield && receiver && receiver.id !== origin.id && incoming > 0) {
    damage(db, receiver, incoming, false, 'psychiczne');
    log(b, `${origin.name}: Thought Shield → ${receiver.name}, ${receiver.lastDamage.amount} obrażeń psychicznych.`);
    incoming = receiver.lastDamage.amount;
    [origin, receiver] = [receiver, origin];
  }
}
