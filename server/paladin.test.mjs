import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paladinResources, paladinChoiceUpdate, handlePaladin, restPaladin, syncDivineSense, activateVow, syncVows, vowAttackAdvantage } from './paladin.mjs';
import { spellcastingProfile } from '../shared/spellcasting.mjs';
import { fightingStyleChoicesValid } from '../shared/fighting-style.mjs';

const hero = level => ({ class: 'Paladyn (Paladin)', level });
const selection = () => ({ choices: { style: '' }, selections: { prepared: ['heroism', 'searing-smite'] } });
test('Vengeance level 3 grants oath spells outside four preparations and three first-level slots', () => {
  const character = { ...hero(3), subclass: 'Oath of Vengeance' };
  const p = spellcastingProfile(character);
  assert.equal(p.slots[0], 3);
  assert.equal(p.groups.find(g => g.id === 'prepared').limit, 4);
  assert.deepEqual(new Set(p.automatic.map(s => s.id)), new Set(['bane', 'hunter-s-mark', 'divine-smite']));
  assert.ok(!p.groups.find(g => g.id === 'prepared').options.some(s => s.id === 'bane'));
  assert.ok(!spellcastingProfile({ ...character, level: 2 }).automatic.some(s => s.id === 'bane'));
});

test('Vow spends shared Channel Divinity, transfers without cost or duration reset and expires', () => {
  let state = {};
  let character = { ...hero(3), subclass: 'Oath of Vengeance' };
  const db = { prepare(sql) { return {
    get() { return sql.includes('FROM characters') ? character : { data: JSON.stringify(state) }; },
    run(id, data) { state = JSON.parse(data); },
  }; } };
  const actor = { id: 'a', characterId: 1, hp: 10, deathFailures: 0 };
  const target = { id: 't', hp: 10, deathFailures: 0 };
  const other = { id: 'o', hp: 10, deathFailures: 0 };
  const b = { fighters: [actor, target, other], turn: 0, round: 1 };
  character.level = 2;
  assert.throws(() => activateVow(db, b, actor, 't'));
  character.level = 3;
  assert.throws(() => activateVow(db, b, actor, 'a'));
  activateVow(db, b, actor, 't');
  assert.equal(state.channelDivinitySpent, 1);
  assert.equal(vowAttackAdvantage(actor, target), true);
  assert.equal(vowAttackAdvantage(actor, other), false);
  const context = { db, b, body: { kind: 'vow-of-enmity-transfer', actorId: 'a', targetId: 'o' }, canControl: () => true, activeMember: () => true, log() {} };
  assert.throws(() => handlePaladin(context));
  target.hp = 0; syncVows(b);
  b.turn = 1; // Transfer needs no action and is allowed outside the paladin turn.
  handlePaladin(context);
  assert.equal(state.channelDivinitySpent, 1);
  assert.equal(actor.vowOfEnmity.expiresRound, 11);
  assert.equal(vowAttackAdvantage(actor, other), true);
  activateVow(db, b, actor, 'o');
  assert.equal(state.channelDivinitySpent, 2);
  assert.throws(() => activateVow(db, b, actor, 'o'));
  b.round = 11; b.turn = 0; syncVows(b);
  assert.equal(actor.vowOfEnmity, null);
});
test('Channel Divinity unlocks at 3, grows at 11 and recovers one use per short rest', () => {
  for (const [level, max] of [[2, 0], [3, 2], [10, 2], [11, 3], [20, 3]]) {
    assert.equal(paladinResources(hero(level)).channelDivinityMax, max);
  }
  assert.equal(paladinResources({ class: 'Druid', level: 11 }).channelDivinityMax, 0);
  const state = { channelDivinitySpent: 2 };
  restPaladin(hero(3), state, 'short');
  assert.equal(paladinResources(hero(3), state).channelDivinityRemaining, 1);
  restPaladin(hero(3), state, 'long');
  assert.equal(paladinResources(hero(3), state).channelDivinityRemaining, 2);
  restPaladin(hero(3), state, 'short');
  assert.equal(state.channelDivinitySpent, 0);
});

test('Divine Sense consumes a bonus action and shared resource, persists and ends on incapacitation or expiry', () => {
  let state = { version: 0 };
  let level = 3;
  const db = { prepare(sql) { return {
    get() { return sql.includes('FROM characters') ? hero(level) : { data: JSON.stringify(state) }; },
    run(id, data) { state = JSON.parse(data); },
  }; } };
  const actor = { id: 'a', name: 'Paladin', characterId: 1, hp: 10, deathFailures: 0 };
  const context = { db, b: { fighters: [actor], turn: 0 }, body: { kind: 'divine-sense' }, canControl: () => true, activeMember: () => true, log() {} };
  level = 2;
  assert.throws(() => handlePaladin(context));
  assert.equal(state.channelDivinitySpent, undefined);
  level = 3;
  const start = Date.now();
  assert.equal(handlePaladin(context), true);
  assert.equal(actor.bonus, 'Divine Sense');
  assert.equal(state.channelDivinitySpent, 1);
  assert.ok(state.divineSense.expiresAt >= start + 600000);
  assert.equal(state.divineSense.radiusFeet, 60);
  assert.deepEqual(state.divineSense.creatureTypes, ['celestial', 'fiend', 'undead']);
  assert.throws(() => handlePaladin(context));
  actor.divineSense = null;
  syncDivineSense(db, context.b);
  assert.equal(actor.divineSense.expiresAt, state.divineSense.expiresAt);
  actor.incapacitated = true;
  syncDivineSense(db, context.b);
  assert.equal(state.divineSense, null);
  actor.incapacitated = false; actor.bonus = null;
  handlePaladin(context);
  actor.bonus = null;
  assert.throws(() => handlePaladin(context));
  state.divineSense.expiresAt = Date.now() - 1;
  syncDivineSense(db, context.b);
  assert.equal(actor.divineSense, null);
  assert.equal(state.channelDivinitySpent, 2);
});
test('Paladin levels 1–2 slots, preparations, styles and resources', () => {
  for (const level of [1, 2]) {
    const p = spellcastingProfile(hero(level));
    assert.equal(p.slots[0], 2);
    assert.equal(p.groups.find(g => g.id === 'prepared').limit, level + 1);
    assert.equal(p.automatic.some(s => s.id === 'divine-smite'), level === 2);
    assert.equal(paladinResources(hero(level)).layOnHandsRemaining, level * 5);
    assert.equal(paladinResources(hero(level)).smiteAvailable, level === 2);
    assert.equal(fightingStyleChoicesValid(hero(level), 'defense'), level === 2);
  }
  assert.equal(paladinResources(hero(2), { layOnHandsSpent: 7, paladinSmiteUsed: true }).layOnHandsRemaining, 3);
  assert.equal(paladinResources(hero(2), { paladinSmiteUsed: true }).smiteAvailable, false);
});
test('prepared spell replacement requires a fresh long rest and cannot be repeated', () => {
  const first = paladinChoiceUpdate(hero(1), selection(), null, {});
  assert.ok(first.history);
  const next = selection(); next.selections.prepared[0] = 'bless';
  assert.ok(paladinChoiceUpdate(hero(1), next, { paladinProgression: first.history }, {}).error);
  const changed = paladinChoiceUpdate(hero(1), next, { paladinProgression: first.history }, { lastLongRest: 10 });
  assert.ok(changed.history);
  assert.ok(paladinChoiceUpdate(hero(1), selection(), { paladinProgression: changed.history }, { lastLongRest: 10 }).error);
});
test('advancing to Vengeance replaces a newly automatic preparation without requiring a rest', () => {
  const before = { choices: { style: '' }, selections: { prepared: ['heroism', 'searing-smite', 'bane'] } };
  const initial = paladinChoiceUpdate(hero(2), before, null, {});
  const spells = { choices: { style: '' }, selections: { prepared: ['heroism', 'searing-smite', 'bless', 'cure-wounds'] } };
  const result = paladinChoiceUpdate({ ...hero(3), subclass: 'Oath of Vengeance' }, spells, { paladinProgression: initial.history }, {});
  assert.ok(result.history);
});
test('Lay on Hands spends points, heals a fallen ally and rejects overspending', () => {
  let state = { spent: [], version: 0 };
  const db = { prepare(sql) { return {
    get() { return sql.includes('FROM characters') ? hero(2) : { data: JSON.stringify(state) }; },
    run(id, data) { state = JSON.parse(data); },
  }; } };
  const actor = { id: 'a', name: 'Paladyn (Paladin)', characterId: 1, hp: 10, deathFailures: 0 };
  const target = { id: 't', name: 'Ally', hp: 0, maxHp: 20, deathFailures: 2, unconscious: true };
  const context = { db, b: { fighters: [actor, target], turn: 0 }, canControl: () => true, activeMember: () => true, persistVitals() {}, log() {} };
  assert.equal(handlePaladin({ ...context, body: { kind: 'lay-on-hands', targetId: 't', mode: 'heal', amount: 7 } }), true);
  assert.equal(target.hp, 7); assert.equal(target.deathFailures, 0); assert.equal(target.unconscious, false);
  assert.equal(state.layOnHandsSpent, 7);
  actor.bonus = null;
  assert.throws(() => handlePaladin({ ...context, body: { kind: 'lay-on-hands', targetId: 't', mode: 'poison' } }));
  assert.equal(state.layOnHandsSpent, 7);
});
