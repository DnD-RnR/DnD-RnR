import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from './db.mjs';
import { emptyStatistics } from './statistics.mjs';
import { handleBattles } from './battles.mjs';
import { handleSpellResources, resourceState, publicCaster, saveResources, speciesResourceState, spendSpell } from './spell-resources.mjs';
import progression from '../shared/spell-progression.json' with { type: 'json' };
import { exportRows, hydrate } from './firestore.mjs';
import { enfeeblementReduction, syncSpellConditions } from './spell-conditions.mjs';
import { strongestEffects, timedAc, timedRollModifier, timedHpBonus } from '../shared/timed-effects.mjs';
import { handleStatistics } from './statistics.mjs';
import { hasCondition, isIncapacitated } from '../shared/conditions.mjs';
import { defendSpellDamage, spellDamageParts } from '../shared/spell-damage.mjs';
import { startConcentration } from './concentration.mjs';
import { scheduleSpellDamage, dueSpellDamage, beginDelayedSpellDamage } from './delayed-spells.mjs';

test('Acid Arrow miss deals only half initial upcast damage and never schedules aftermath', () => {
  const { db, start, call, gm } = setup('wizard', 20);
  try {
    chooseTimedSpell(db, 'melfs-acid-arrow');
    const enemy = start().battle.fighters[1].id;
    assert.equal(call('act', { kind: 'cast', slot: 'action', spellId: 'melfs-acid-arrow', source: 'slot', level: 3, targetIds: [enemy] }).status, 200);
    const miss = call('act', { kind: 'spell-attack', roll: 1 });
    assert.equal(miss.battle.pending.missed, true);
    assert.equal(miss.battle.pending.spec.dice, 5);
    call('act', { kind: 'spell-defense', targetId: enemy, multiplier: 1 }, gm);
    const result = call('act', { kind: 'spell-effect', rolls: [3, 3, 3, 3, 3] });
    assert.equal(result.status, 200);
    assert.equal(result.battle.fighters[1].damageTaken, 7);
    assert.deepEqual(result.battle.delayedSpellDamage, []);
    assert.equal(resourceState(db, 1).spent[2], 1);
  } finally { db.close(); }
});

test('Acid Arrow critical doubles initial dice only; aftermath survives its caster and uses current defenses', () => {
  const { db, start, call, gm } = setup('wizard', 20);
  try {
    chooseTimedSpell(db, 'melfs-acid-arrow');
    const b = start().battle, self = b.fighters[0].id, enemy = b.fighters[1].id;
    call('act', { kind: 'cast', slot: 'action', spellId: 'melfs-acid-arrow', source: 'slot', level: 4, targetIds: [enemy] });
    assert.equal(call('act', { kind: 'spell-attack', roll: 20 }).battle.pending.critical, true);
    call('act', { kind: 'spell-defense', targetId: enemy, multiplier: 1 }, gm);
    const initial = call('act', { kind: 'spell-effect', rolls: Array(12).fill(1) });
    assert.equal(initial.battle.fighters[1].damageTaken, 12);
    assert.equal(initial.battle.delayedSpellDamage[0].dice, 4);
    assert.equal(initial.battle.delayedSpellDamage[0].round, 1);
    assert.equal(call('end', {}, gm).status, 409);
    call('act', { kind: 'resolve', note: 'Caster falls', targetId: self, effect: 'damage', amount: 50 }, gm);
    call('next', {}, gm);
    call('act', { kind: 'condition', actorId: enemy, condition: 'petrified', enabled: true }, gm);
    assert.equal(call('act', { kind: 'delayed-spell', actorId: enemy, effectId: initial.battle.delayedSpellDamage[0].id }).status, 409);
    const ending = call('next', {}, gm);
    assert.equal(ending.battle.turn, 1, 'next opens the end-turn effect before advancing');
    assert.equal(ending.battle.pending.spec.dice, 4);
    assert.equal(ending.battle.pending.critical, undefined);
    assert.equal(call('next', {}, gm).status, 409, 'GM cannot skip delayed damage');
    assert.equal(call('act', { kind: 'spell-effect', rolls: [1, 1, 1, 2] }, gm).status, 409, 'defenses must be checked anew');
    call('act', { kind: 'spell-defense', targetId: enemy, multiplier: 1 }, gm);
    const aftermath = call('act', { kind: 'spell-effect', rolls: [1, 1, 1, 2] }, gm);
    assert.equal(aftermath.status, 200);
    assert.equal(aftermath.battle.fighters[1].damageTaken, 14, 'Petrified halves only the later damage');
    assert.deepEqual(aftermath.battle.delayedSpellDamage, []);
    assert.equal(call('next', {}, gm).battle.turn, 2);
    assert.equal(resourceState(db, 1).spent[3], 1);
  } finally { db.close(); }
});

test('Vitriolic Sphere successful save skips aftermath; upcasting only scales initial damage', () => {
  const { db, start, call, gm, ally } = setup('wizard', 20);
  try {
    chooseTimedSpell(db, 'vitriolic-sphere');
    const stats = JSON.parse(db.prepare('SELECT data FROM character_statistics WHERE character_id = 2').get().data);
    Object.assign(stats.values, { hp: 100, maxHp: 100 });
    db.prepare('UPDATE character_statistics SET data = ? WHERE character_id = 2').run(JSON.stringify(stats));
    startConcentration(db, { characterId: 2 }, { id: 'bless', name: 'Bless', duration: '1 minute' });
    const b = start().battle, enemy = b.fighters[1].id, friend = b.fighters[2].id;
    const cast = call('act', { kind: 'cast', slot: 'action', spellId: 'vitriolic-sphere', source: 'slot', level: 6, targetIds: [enemy, friend] });
    assert.equal(cast.battle.pending.spec.dice, 14);
    call('act', { kind: 'spell-save', targetId: enemy, roll: 20 }, gm);
    call('act', { kind: 'spell-save', targetId: friend, roll: 1 }, ally);
    for (const targetId of [enemy, friend]) call('act', { kind: 'spell-defense', targetId, multiplier: 1 }, gm);
    const initial = call('act', { kind: 'spell-effect', rolls: Array(14).fill(1) });
    assert.equal(initial.battle.fighters[1].damageTaken, 7);
    assert.equal(initial.battle.fighters[2].hp, 86);
    assert.equal(initial.battle.delayedSpellDamage.length, 1);
    const effect = initial.battle.delayedSpellDamage[0];
    assert.equal(effect.dice, 5);
    assert.equal(call('act', { kind: 'delayed-spell', actorId: friend, effectId: effect.id }, ally).status, 409, 'not the target turn yet');
    call('act', { kind: 'concentration', actorId: friend, roll: 20 }, ally);
    call('next', {}, gm); call('next', {}, gm);
    assert.equal(call('act', { kind: 'delayed-spell', actorId: friend, effectId: effect.id }).status, 409, 'another player cannot resolve it');
    assert.equal(call('act', { kind: 'delayed-spell', actorId: friend, effectId: effect.id }, ally).status, 200);
    assert.equal(call('act', { kind: 'spell-effect', rolls: Array(5).fill(4) }).status, 409, 'another player cannot roll damage');
    call('act', { kind: 'spell-defense', targetId: friend, multiplier: 1 }, gm);
    const restored = hydrate(exportRows(db));
    try {
      const stored = JSON.parse(restored.prepare('SELECT data FROM session_battles WHERE session_id = 1').get().data);
      assert.equal(stored.pending.delayedDamageId, effect.id);
      assert.equal(stored.delayedSpellDamage[0].id, effect.id);
    } finally { restored.close(); }
    const later = call('act', { kind: 'spell-effect', rolls: Array(5).fill(4) }, ally);
    assert.equal(later.status, 200);
    assert.equal(later.battle.fighters[2].hp, 66);
    assert.deepEqual(later.battle.fighters[2].concentrationChecks, [10]);
    assert.equal(call('act', { kind: 'skip', slot: 'action' }, ally).status, 409, 'end-turn processing locks actions');
    assert.equal(call('next', {}, gm).status, 409, 'resolve concentration from the second damage source');
    call('act', { kind: 'concentration', actorId: friend, roll: 20 }, ally);
    assert.equal(call('next', {}, ally).battle.turn, 0);
    assert.equal(resourceState(db, 1).spent[5], 1);
  } finally { db.close(); }
});

test('delayed events use the next target turn even during that turn and allow an explicit order', () => {
  const source = { id: 'source', name: 'Wizard' }, target = { id: 'target' };
  const b = { fighters: [source, target], round: 1, turn: 1, pending: null };
  const pending = { spec: { type: 'Acid', delayed: { dice: 2, sides: 4 } }, spellId: 'melfs-acid-arrow', spellName: 'Acid Arrow', castingLevel: 2, spellLevel: 2, targets: [{ id: target.id }] };
  scheduleSpellDamage(b, source, target, pending);
  scheduleSpellDamage(b, source, target, pending);
  assert.equal(b.delayedSpellDamage.length, 2);
  assert.equal(dueSpellDamage(b, target).length, 0);
  b.round = 2;
  assert.equal(dueSpellDamage(b, target).length, 2);
  const second = b.delayedSpellDamage[1];
  assert.equal(beginDelayedSpellDamage(b, target, second.id), true);
  assert.equal(b.pending.delayedDamageId, second.id);
  assert.throws(() => beginDelayedSpellDamage(b, target), /działanie/);
});

test('Shield changing Acid Arrow to a miss preserves splash damage but removes critical/Hex and aftermath', () => {
  const { db, start, call, gm, ally } = setup('wizard', 5);
  try {
    chooseTimedSpell(db, 'melfs-acid-arrow');
    db.prepare('UPDATE characters SET class = ?, level = 5 WHERE id = 2').run('Czarodziej (Wizard)');
    const stats = JSON.parse(db.prepare('SELECT data FROM character_statistics WHERE character_id = 2').get().data);
    stats.spells.selections = { book: ['shield'], prepared: ['shield'] };
    db.prepare('UPDATE character_statistics SET data = ? WHERE character_id = 2').run(JSON.stringify(stats));
    const friend = start().battle.fighters[2].id;
    call('act', { kind: 'cast', slot: 'action', spellId: 'melfs-acid-arrow', source: 'slot', level: 2, targetIds: [friend] });
    assert.equal(call('act', { kind: 'spell-attack', roll: 7 }).battle.pending.stage, 'effect'); // 7 + 6 hits base AC 11
    const shield = call('act', { kind: 'cast', actorId: friend, slot: 'reaction', spellId: 'shield', source: 'slot', level: 1 }, ally);
    assert.equal(shield.status, 200, shield.error);
    assert.equal(shield.battle.pending.missed, true);
    call('act', { kind: 'spell-defense', targetId: friend, multiplier: 1 }, gm);
    const splash = call('act', { kind: 'spell-effect', rolls: [1, 1, 1, 2] });
    assert.equal(splash.status, 200);
    assert.equal(splash.battle.fighters[2].hp, 13);
    assert.deepEqual(splash.battle.delayedSpellDamage, []);
  } finally { db.close(); }
});

test('aftermath at zero HP is not a critical hit, consumes no action and cannot be replayed', () => {
  const { db, start, call, gm, ally } = setup('wizard', 20);
  try {
    chooseTimedSpell(db, 'melfs-acid-arrow');
    const friend = start().battle.fighters[2].id;
    call('act', { kind: 'cast', slot: 'action', spellId: 'melfs-acid-arrow', source: 'slot', level: 2, targetIds: [friend] });
    call('act', { kind: 'spell-attack', roll: 20 });
    call('act', { kind: 'spell-defense', targetId: friend, multiplier: 1 }, gm);
    const initial = call('act', { kind: 'spell-effect', rolls: Array(8).fill(2) });
    assert.equal(initial.battle.fighters[2].hp, 0);
    const id = initial.battle.delayedSpellDamage[0].id;
    call('next', {}, gm); call('next', {}, gm);
    assert.equal(call('act', { kind: 'delayed-spell', actorId: friend, effectId: id }, ally).status, 200);
    call('act', { kind: 'spell-defense', targetId: friend, multiplier: 1 }, gm);
    const after = call('act', { kind: 'spell-effect', rolls: [1, 1] }, ally);
    assert.equal(after.status, 200);
    assert.equal(after.battle.fighters[2].deathFailures, 1);
    assert.equal(after.battle.fighters[2].action, '');
    assert.deepEqual(after.battle.delayedSpellDamage, []);
    assert.equal(call('act', { kind: 'spell-effect', rolls: [1, 1] }, ally).status, 409);
    assert.equal(call('act', { kind: 'delayed-spell', actorId: friend, effectId: id }, ally).status, 409);
    assert.equal(call('next', {}, ally).status, 200);
  } finally { db.close(); }
});

test('mixed spell damage is one concentration event, with separate saves and defenses per target', () => {
  const { db, start, call, gm, ally } = setup('wizard', 20);
  try {
    chooseTimedSpell(db, 'ice-storm');
    const stats = JSON.parse(db.prepare('SELECT data FROM character_statistics WHERE character_id = 2').get().data);
    Object.assign(stats.values, { hp: 100, maxHp: 100 });
    db.prepare('UPDATE character_statistics SET data = ? WHERE character_id = 2').run(JSON.stringify(stats));
    startConcentration(db, { characterId: 2 }, { id: 'bless', name: 'Bless', duration: '1 minute' });
    const battle = start().battle, enemy = battle.fighters[1].id, friend = battle.fighters[2].id;
    call('act', { kind: 'cast', slot: 'action', spellId: 'ice-storm', source: 'slot', level: 4, targetIds: [enemy, friend] });
    call('act', { kind: 'spell-save', targetId: enemy, roll: 20 }, gm);
    call('act', { kind: 'spell-save', targetId: friend, roll: 1 }, ally);
    for (const targetId of [enemy, friend]) for (const damageType of ['Bludgeoning', 'Cold']) {
      assert.equal(call('act', { kind: 'spell-defense', targetId, damageType, multiplier: 1 }).status, 409);
      assert.equal(call('act', { kind: 'spell-defense', targetId, damageType, multiplier: 1 }, gm).status, 200);
    }
    const result = call('act', { kind: 'spell-effect', rolls: [10, 9, 6, 6, 6, 5] });
    assert.equal(result.status, 200);
    assert.equal(result.battle.fighters[1].damageTaken, 20); // floor(19/2) + floor(23/2)
    assert.equal(result.battle.fighters[2].hp, 58);
    assert.deepEqual(result.battle.fighters[2].concentrationChecks, [21]);
    assert.equal(call('next', {}, gm).status, 409);
    assert.equal(call('act', { kind: 'concentration', actorId: friend, roll: 20 }, ally).status, 200);
    assert.equal(call('next', {}, gm).status, 200);
  } finally { db.close(); }
});

test('typed spell damage rounds resistance before vulnerability and applies reductions only once', () => {
  const spec = { components: [{ dice: 1, sides: 10, type: 'Fire' }, { dice: 1, sides: 6, type: 'Cold' }], bonus: 0 };
  const parts = spellDamageParts(spec, [9, 5], 2);
  assert.deepEqual(parts, [{ type: 'Fire', amount: 7 }, { type: 'Cold', amount: 5 }]);
  assert.deepEqual(defendSpellDamage(parts, false, true, { Fire: { resistant: true, vulnerable: true }, Cold: { immune: true } }), [{ type: 'Fire', amount: 6 }, { type: 'Cold', amount: 0 }]);
  assert.deepEqual(defendSpellDamage(parts, true, true, {}, 4), [{ type: 'Fire', amount: 0 }, { type: 'Cold', amount: 1 }]);
  assert.deepEqual(spellDamageParts({ ...spec, components: spec.components.map(c => ({ ...c, type: 'Psychic' })) }, [9, 5]), [{ type: 'Psychic', amount: 14 }]);
});

test('SRD mixed damage spells scale components, validate each die and require defenses for every type', () => {
  for (const [classId, id, level, sizes, expected] of [
    ['wizard', 'ice-storm', 4, [10, 10, 6, 6, 6, 6], 5],
    ['wizard', 'ice-storm', 6, [10, 10, 10, 10, 6, 6, 6, 6], 6],
    ['cleric', 'flame-strike', 5, Array(10).fill(6), 7],
    ['cleric', 'flame-strike', 6, Array(12).fill(6), 9],
    ['wizard', 'meteor-swarm', 9, Array(40).fill(6), 30],
  ]) {
    const { db, start, call, gm } = setup(classId, 20);
    try {
      chooseTimedSpell(db, id);
      const target = start().battle.fighters[1].id;
      const cast = { kind: 'cast', slot: 'action', spellId: id, source: 'slot', level, targetIds: [target] };
      assert.equal(call('act', { ...cast, targetIds: [target, target] }).status, 409, 'overlapping areas cannot duplicate a target');
      const pending = call('act', cast).battle.pending;
      assert.equal(pending.spec.components.reduce((n, c) => n + c.dice, 0), sizes.length);
      assert.equal(call('act', { kind: 'spell-save', targetId: target, roll: 1 }, gm).status, 200);
      assert.equal(call('act', { kind: 'spell-defense', targetId: target, damageType: 'Force', multiplier: 1 }, gm).status, 409);
      const [first, second] = pending.spec.components;
      call('act', { kind: 'spell-defense', targetId: target, damageType: first.type, multiplier: 0.5 }, gm);
      assert.equal(call('act', { kind: 'spell-effect', rolls: sizes.map(() => 1) }).status, 409);
      call('act', { kind: 'spell-defense', targetId: target, damageType: second.type, multiplier: 1 }, gm);
      const invalid = sizes.map(() => 1); invalid[invalid.length - 1] = 7;
      assert.equal(call('act', { kind: 'spell-effect', rolls: invalid }).status, 409);
      const result = call('act', { kind: 'spell-effect', rolls: sizes.map(() => 1) });
      assert.equal(result.status, 200, id);
      assert.equal(result.battle.fighters[1].damageTaken, expected, id);
      assert.equal(result.battle.pending, null);
      assert.equal(resourceState(db, 1).spent.reduce((n, v) => n + v, 0), 1);
    } finally { db.close(); }
  }
});

test('manual SRD conditions affect movement and actions, and persist between encounters', () => {
  for (const [condition, movementStatus] of [['stunned', 200], ['incapacitated', 200], ['paralyzed', 409], ['petrified', 409], ['restrained', 409], ['unconscious', 409]]) {
    const { db, start, call, gm } = setup('wizard', 5);
    try {
      const id = start().battle.fighters[0].id;
      assert.equal(call('act', { kind: 'condition', actorId: id, condition, enabled: true }, gm).status, 200);
      assert.equal(call('act', { kind: 'move', feet: 5 }).status, movementStatus, condition);
      if (condition !== 'restrained') assert.equal(call('act', { kind: 'cast', slot: 'action', spellId: 'fire-bolt', source: 'cantrip', level: 0, targetIds: [call().battle.fighters[1].id] }).status, 409, condition);
      call('end', {}, gm);
      const restarted = start();
      assert.equal(hasCondition(restarted.battle.fighters[0], condition), true, condition);
    } finally { db.close(); }
  }
});

test('Unconscious leaves Prone behind; crawling and standing spend movement without an action', () => {
  const { db, start, call, gm } = setup('wizard', 5);
  try {
    const id = start().battle.fighters[0].id;
    call('act', { kind: 'condition', actorId: id, condition: 'unconscious', enabled: true }, gm);
    call('act', { kind: 'condition', actorId: id, condition: 'unconscious', enabled: false }, gm);
    assert.equal(hasCondition(call().battle.fighters[0], 'prone'), true);
    assert.equal(isIncapacitated(call().battle.fighters[0]), false);
    assert.equal(call('act', { kind: 'move', feet: 5 }).battle.fighters[0].moved, 10);
    const standing = call('act', { kind: 'stand-up' });
    assert.equal(standing.status, 200);
    assert.equal(standing.battle.fighters[0].moved, 25);
    assert.equal(hasCondition(standing.battle.fighters[0], 'prone'), false);
    assert.equal(standing.battle.fighters[0].action, '');
    assert.equal(call('act', { kind: 'move', feet: 6 }).status, 409);
    assert.equal(call('act', { kind: 'move', feet: 5 }).status, 200);
  } finally { db.close(); }
});

test('Petrified resists even untyped damage and refuses new Poisoned sources', () => {
  const { db, start, call, gm } = setup('wizard', 5);
  try {
    const id = start().battle.fighters[2].id;
    call('act', { kind: 'condition', actorId: id, condition: 'petrified', enabled: true }, gm);
    const result = call('act', { kind: 'resolve', note: 'Damage', targetId: id, effect: 'damage', amount: 5 }, gm);
    assert.equal(result.battle.fighters[2].hp, 13);
    assert.equal(call('act', { kind: 'condition', actorId: id, condition: 'poisoned', enabled: true }, gm).status, 409);
  } finally { db.close(); }
});

test('automated spell damage does not apply Petrified resistance twice', () => {
  for (const multiplier of [1, 0.5]) {
    const { db, start, call, gm } = setup('wizard', 3);
    try {
      const id = start().battle.fighters[2].id;
      call('act', { kind: 'condition', actorId: id, condition: 'petrified', enabled: true }, gm);
      call('act', { kind: 'cast', slot: 'action', spellId: 'fire-bolt', source: 'cantrip', level: 0, targetIds: [id] });
      assert.equal(call('act', { kind: 'spell-attack', roll: 15, roll2: 15 }).status, 200);
      call('act', { kind: 'spell-defense', targetId: id, multiplier }, gm);
      const hit = call('act', { kind: 'spell-effect', rolls: [5] });
      assert.equal(hit.status, 200);
      assert.equal(hit.battle.fighters[2].hp, 13);
    } finally { db.close(); }
  }
});

test('Restrained imposes Dexterity save disadvantage while Stunned automatically fails without dice', () => {
  for (const condition of ['restrained', 'stunned']) {
    const { db, start, call, gm, ally } = setup('wizard', 5);
    try {
      const id = start().battle.fighters[2].id;
      call('act', { kind: 'condition', actorId: id, condition, enabled: true }, gm);
      call('act', { kind: 'cast', slot: 'action', spellId: 'burning-hands', source: 'slot', level: 1, targetIds: [id] });
      if (condition === 'restrained') {
        assert.equal(call('act', { kind: 'spell-save', targetId: id, roll: 20 }, ally).status, 409);
        assert.equal(call('act', { kind: 'spell-save', targetId: id, roll: 20, roll2: 1 }, ally).status, 200);
      } else {
        const failed = call('act', { kind: 'spell-save', targetId: id }, ally);
        assert.equal(failed.status, 200);
        assert.equal(failed.battle.pending.targets[0].saved, false);
      }
    } finally { db.close(); }
  }
});

test('Color Spray applies 2024 CON-based blindness through the end of the next caster turn', () => {
  const { db, start, call, gm, ally } = setup('wizard', 5);
  try {
    chooseTimedSpell(db, 'color-spray');
    const id = start().battle.fighters[2].id;
    assert.equal(call('act', { kind: 'cast', slot: 'action', spellId: 'color-spray', source: 'slot', level: 1, targetIds: [id] }).status, 200);
    call('act', { kind: 'spell-save', targetId: id, roll: 1 }, ally);
    call('act', { kind: 'spell-defense', targetId: id, multiplier: 1 }, gm);
    assert.equal(call('act', { kind: 'spell-effect', rolls: [] }).status, 200);
    assert.equal(hasCondition(call().battle.fighters[2], 'blinded'), true);
    call('next', {}, gm); call('next', {}, gm);
    assert.equal(call('act', { kind: 'ability-check', actorId: id, ability: 'wis', requiresSight: true }, ally).status, 200);
    call('next', {}, ally);
    assert.equal(hasCondition(call().battle.fighters[2], 'blinded'), true);
    call('next', {}, gm);
    assert.equal(hasCondition(call().battle.fighters[2], 'blinded'), false);
  } finally { db.close(); }
});

test('Blindness/Deafness scales targets, requires a choice and allows non-concentration repeated saves', () => {
  for (const conditionChoice of ['blinded', 'deafened']) {
    const { db, start, call, gm, ally } = setup('wizard', 5);
    try {
      chooseTimedSpell(db, 'blindness-deafness');
      const b = start().battle, ids = [b.fighters[1].id, b.fighters[2].id];
      const cast = { kind: 'cast', slot: 'action', spellId: 'blindness-deafness', source: 'slot', level: 3, targetIds: ids };
      assert.equal(call('act', { ...cast, conditionChoice: 'stunned' }).status, 409);
      assert.equal(call('act', { ...cast, conditionChoice }).status, 200);
      call('act', { kind: 'spell-save', targetId: ids[0], roll: 1 }, gm);
      call('act', { kind: 'spell-save', targetId: ids[1], roll: 1 }, ally);
      for (const id of ids) call('act', { kind: 'spell-defense', targetId: id, multiplier: 1 }, gm);
      assert.equal(call('act', { kind: 'spell-effect', rolls: [] }).status, 200);
      call('act', { kind: 'condition', actorId: b.fighters[0].id, condition: 'incapacitated', enabled: true }, gm);
      assert.equal(hasCondition(call().battle.fighters[2], conditionChoice), true);
      call('next', {}, gm);
      assert.equal(call('next', {}, gm).status, 409);
      let effect = call('', {}, gm).battle.fighters[1].timedEffects[0];
      assert.equal(call('act', { kind: 'condition-save', actorId: ids[0], effectId: effect.id, roll: 20 }, gm).status, 200);
      call('next', {}, gm);
      effect = call().battle.fighters[2].timedEffects[0];
      assert.equal(call('act', { kind: 'condition-save', actorId: ids[1], effectId: effect.id, roll: 20 }, ally).status, 200);
      assert.equal(hasCondition(call().battle.fighters[2], conditionChoice), false);
      assert.equal(call('next', {}, ally).status, 200);
    } finally { db.close(); }
  }
});

test('Hold Monster paralyzes without the Humanoid restriction and ends on a repeated Wisdom save', () => {
  const { db, start, call, gm } = setup('wizard', 9);
  try {
    chooseTimedSpell(db, 'hold-monster');
    const id = start().battle.fighters[1].id;
    assert.equal(call('act', { kind: 'cast', slot: 'action', spellId: 'hold-monster', source: 'slot', level: 5, targetIds: [id] }).status, 200);
    call('act', { kind: 'spell-save', targetId: id, roll: 1 }, gm);
    call('act', { kind: 'spell-defense', targetId: id, multiplier: 1 }, gm);
    call('act', { kind: 'spell-effect', rolls: [] });
    assert.equal(hasCondition(call().battle.fighters[1], 'paralyzed'), true);
    assert.equal(call('', {}, gm).battle.fighters[1].speed, 0);
    call('next', {}, gm);
    const effectId = call('', {}, gm).battle.fighters[1].timedEffects[0].id;
    assert.equal(call('act', { kind: 'condition-save', actorId: id, effectId, roll: 20 }, gm).status, 200);
    assert.equal(hasCondition(call().battle.fighters[1], 'paralyzed'), false);
  } finally { db.close(); }
});

test('Power Word Stun uses current HP at the 150 threshold, with no initial save and no invented duration', () => {
  for (const hp of [150, 151]) {
    const { db, start, call, gm, ally } = setup('wizard', 15);
    try {
      chooseTimedSpell(db, 'power-word-stun');
      const stats = JSON.parse(db.prepare('SELECT data FROM character_statistics WHERE character_id = 2').get().data);
      Object.assign(stats.values, { hp, maxHp: 300 });
      db.prepare('UPDATE character_statistics SET data = ? WHERE character_id = 2').run(JSON.stringify(stats));
      const b = start().battle, targetId = b.fighters[2].id;
      const cast = call('act', { kind: 'cast', slot: 'action', spellId: 'power-word-stun', source: 'slot', level: 8, targetIds: [targetId] });
      assert.equal(cast.status, 200);
      assert.equal(cast.battle.pending.stage, 'effect');
      call('act', { kind: 'spell-defense', targetId, multiplier: 1 }, gm);
      const applied = call('act', { kind: 'spell-effect', rolls: [] });
      assert.equal(hasCondition(applied.battle.fighters[2], 'stunned'), hp === 150);
      assert.equal(applied.battle.fighters[2].speed, hp === 150 ? 30 : 0);
      call('next', {}, gm); call('next', {}, gm);
      if (hp === 150) {
        const effect = call().battle.fighters[2].timedEffects[0];
        assert.equal(effect.endRound, null);
        assert.equal(call('act', { kind: 'move', feet: 5 }, ally).status, 200);
        assert.equal(call('act', { kind: 'attack', slot: 'action', attackId: 'unarmed', targetId: b.fighters[1].id, roll: 15 }, ally).status, 409);
        assert.equal(call('act', { kind: 'condition-save', actorId: targetId, effectId: effect.id, roll: 20 }, ally).status, 200);
      } else {
        assert.equal(call('act', { kind: 'move', feet: 5 }, ally).status, 409);
        assert.equal(call('act', { kind: 'dash' }, ally).status, 200);
      }
      call('next', {}, ally);
      assert.equal(call().battle.fighters[2].speed, 30);
    } finally { db.close(); }
  }
});

test('Lesser Restoration ends the chosen condition from both manual and spell sources', () => {
  const { db, start, call, gm, ally } = setup('wizard', 5);
  try {
    chooseTimedSpell(db, 'blindness-deafness');
    db.prepare('UPDATE characters SET class = ?, level = 5 WHERE id = 2').run('Kleryk (Cleric)');
    const stats = JSON.parse(db.prepare('SELECT data FROM character_statistics WHERE character_id = 2').get().data);
    stats.spells.selections = { prepared: ['lesser-restoration'] };
    db.prepare('UPDATE character_statistics SET data = ? WHERE character_id = 2').run(JSON.stringify(stats));
    const targetId = start().battle.fighters[2].id;
    call('act', { kind: 'condition', actorId: targetId, condition: 'blinded', enabled: true }, gm);
    call('act', { kind: 'cast', slot: 'action', spellId: 'blindness-deafness', conditionChoice: 'blinded', source: 'slot', level: 2, targetIds: [targetId] });
    call('act', { kind: 'spell-save', targetId, roll: 1 }, ally);
    call('act', { kind: 'spell-defense', targetId, multiplier: 1 }, gm);
    call('act', { kind: 'spell-effect', rolls: [] });
    call('next', {}, gm); call('next', {}, gm);
    const healed = call('act', { kind: 'cast', actorId: targetId, slot: 'bonus', spellId: 'lesser-restoration', source: 'slot', level: 2, targetIds: [targetId], conditionChoice: 'blinded' }, ally);
    assert.equal(healed.status, 200);
    assert.equal(hasCondition(healed.battle.fighters[2], 'blinded'), false);
    assert.equal(resourceState(db, 2).activeEffects.length, 0);
    assert.equal(call('next', {}, ally).status, 200);
  } finally { db.close(); }
});

test('paralyzing a caster immediately breaks their concentration and removes buffs from other combatants', () => {
  const { db, start, call, gm, ally } = setup('wizard', 9);
  try {
    chooseTimedSpell(db, 'hold-monster');
    db.prepare('UPDATE characters SET class = ?, level = 5 WHERE id = 2').run('Kleryk (Cleric)');
    const stats = JSON.parse(db.prepare('SELECT data FROM character_statistics WHERE character_id = 2').get().data);
    stats.spells.selections = { prepared: ['shield-of-faith'] };
    db.prepare('UPDATE character_statistics SET data = ? WHERE character_id = 2').run(JSON.stringify(stats));
    const b = start().battle, targetId = b.fighters[2].id;
    call('next', {}, gm); call('next', {}, gm);
    assert.equal(call('act', { kind: 'cast', slot: 'bonus', spellId: 'shield-of-faith', source: 'slot', level: 1, targetIds: [b.fighters[0].id] }, ally).status, 200);
    call('next', {}, ally);
    call('act', { kind: 'cast', slot: 'action', spellId: 'hold-monster', source: 'slot', level: 5, targetIds: [targetId] });
    call('act', { kind: 'spell-save', targetId, roll: 1 }, ally);
    call('act', { kind: 'spell-defense', targetId, multiplier: 1 }, gm);
    const result = call('act', { kind: 'spell-effect', rolls: [] });
    assert.equal(hasCondition(result.battle.fighters[2], 'paralyzed'), true);
    assert.equal(result.battle.fighters[2].concentration, null);
    assert.equal(result.battle.fighters[0].timedEffects.length, 0);
    assert.equal(resourceState(db, 2).concentration, null);
  } finally { db.close(); }
});

test('Power Word Stun is not voluntarily dismissible and failed-save tracking resets in a new encounter', () => {
  const { db, start, call, gm, ally } = setup('wizard', 15);
  try {
    chooseTimedSpell(db, 'power-word-stun');
    const b = start().battle, targetId = b.fighters[2].id;
    call('act', { kind: 'cast', slot: 'action', spellId: 'power-word-stun', source: 'slot', level: 8, targetIds: [targetId] });
    call('act', { kind: 'spell-defense', targetId, multiplier: 1 }, gm);
    const applied = call('act', { kind: 'spell-effect', rolls: [] });
    const effect = applied.battle.fighters[2].timedEffects[0];
    assert.equal(effect.dismissible, false);
    assert.equal(call('act', { kind: 'dismiss-effect', actorId: b.fighters[0].id, castingId: effect.castingId }).status, 409);
    call('next', {}, gm); call('next', {}, gm);
    assert.equal(call('act', { kind: 'condition-save', actorId: targetId, effectId: effect.id, roll: 1 }, ally).status, 200);
    assert.equal(call('end', {}, gm).status, 200);
    const restarted = start().battle;
    assert.equal(hasCondition(restarted.fighters[2], 'stunned'), true);
    assert.equal(restarted.fighters[2].timedEffects[0].lastSaveRound, undefined);
    call('next', {}, gm); call('next', {}, gm);
    assert.equal(call('next', {}, ally).status, 409);
  } finally { db.close(); }
});

function chooseTimedSpell(db, id) {
  const c = db.prepare('SELECT class FROM characters WHERE id = 1').get();
  const stats = JSON.parse(db.prepare('SELECT data FROM character_statistics WHERE character_id = 1').get().data);
  stats.spells.selections = { prepared: [id], ...(c.class.includes('Wizard') ? { book: [id] } : {}) };
  db.prepare('UPDATE character_statistics SET data = ? WHERE character_id = 1').run(JSON.stringify(stats));
}

test('timed modifiers apply to real combat stats and disappear when concentration or the casting ends', () => {
  for (const [spellId, classId, level, circle, slot, field, expected] of [
    ['shield-of-faith', 'cleric', 5, 1, 'bonus', 'ac', 13], ['barkskin', 'druid', 5, 2, 'bonus', 'ac', 17],
    ['mage-armor', 'wizard', 5, 1, 'action', 'ac', 14], ['longstrider', 'wizard', 5, 1, 'action', 'speed', 40],
    ['aid', 'cleric', 5, 2, 'action', 'maxHp', 25], ['stoneskin', 'wizard', 9, 4, 'action', 'ac', 11],
    ['bless', 'cleric', 5, 1, 'action', 'ac', 11],
  ]) {
    const { db, start, call, ally } = setup(classId, level);
    try {
      chooseTimedSpell(db, spellId);
      const b = start().battle, target = b.fighters[2];
      const cast = call('act', { kind: 'cast', slot, spellId, source: 'slot', level: circle, targetIds: [target.id] });
      assert.equal(cast.status, 200, `${spellId}: ${cast.error}`);
      assert.equal(cast.battle.pending, null, spellId);
      assert.equal(cast.battle.fighters[2][field], expected, spellId);
      assert.equal(cast.battle.fighters[2].timedEffects.length, 1);
      const effect = cast.battle.fighters[2].timedEffects[0];
      assert.equal(resourceState(db, 2).activeEffects[0].spellId, spellId);
      const kind = effect.concentrationKey ? 'end-concentration' : 'dismiss-effect';
      assert.equal(call('act', { kind, actorId: b.fighters[0].id, castingId: effect.castingId }, ally).status, 409);
      const ended = call('act', { kind, actorId: b.fighters[0].id, castingId: effect.castingId });
      assert.equal(ended.status, 200, spellId);
      assert.equal(ended.battle.fighters[2].timedEffects.length, 0, spellId);
      assert.equal(ended.battle.fighters[2][field], target[field], spellId);
    } finally { db.close(); }
  }
});

test('SRD overlapping effects select strongest/latest without deleting suppressed castings', () => {
  const effect = (id, potency, createdAt) => ({ id, spellId: 'aid', potency, createdAt, modifiers: { hpBonus: potency } });
  const older = effect('older', 5, 1), stronger = effect('stronger', 15, 2), recent = effect('recent', 5, 3);
  assert.equal(strongestEffects([older, stronger, recent])[0].id, 'stronger');
  assert.equal(timedHpBonus([older, stronger, recent]), 15);
  assert.equal(strongestEffects([older, recent])[0].id, 'recent');
  assert.equal(timedHpBonus([older, recent]), 5);
  assert.equal(timedAc({ ac: 11, timedEffects: [{ spellId: 'barkskin', createdAt: 1, modifiers: { minimumAc: 17 } }, { spellId: 'shield-of-faith', createdAt: 2, modifiers: { acBonus: 2 } }] }), 17);
  assert.equal(timedRollModifier({ timedEffects: [{ spellId: 'bless', createdAt: 1 }, { spellId: 'bless', createdAt: 2 }, { spellId: 'bane', createdAt: 3 }] }, { blessRoll: 4, baneRoll: 2 }), 2);
});

test('Aid potency changes adjust current/max HP once and persist across encounters', () => {
  const { db, start, call, gm } = setup('cleric', 7);
  try {
    chooseTimedSpell(db, 'aid');
    const b = start().battle, target = b.fighters[2].id;
    const first = call('act', { kind: 'cast', slot: 'action', spellId: 'aid', source: 'slot', level: 4, targetIds: [target] });
    assert.equal(first.battle.fighters[2].hp, 30);
    assert.equal(first.battle.fighters[2].maxHp, 35);
    const stronger = first.battle.fighters[2].timedEffects[0].castingId;
    call('next', {}, gm); call('next', {}, gm); call('next', {}, gm);
    const second = call('act', { kind: 'cast', slot: 'action', spellId: 'aid', source: 'slot', level: 2, targetIds: [target] });
    assert.equal(second.battle.fighters[2].hp, 30);
    assert.equal(second.battle.fighters[2].maxHp, 35);
    const dismissed = call('act', { kind: 'dismiss-effect', actorId: b.fighters[0].id, castingId: stronger });
    assert.equal(dismissed.battle.fighters[2].hp, 20);
    assert.equal(dismissed.battle.fighters[2].maxHp, 25);
    call('end', {}, gm);
    const restarted = start();
    assert.equal(restarted.battle.fighters[2].hp, 20);
    assert.equal(restarted.battle.fighters[2].maxHp, 25);
  } finally { db.close(); }
});

test('Stoneskin halves typed damage only once even when GM confirms resistance', () => {
  const { db, start, call, gm } = setup('wizard', 9);
  try {
    chooseTimedSpell(db, 'stoneskin');
    const target = start().battle.fighters[2].id;
    call('act', { kind: 'cast', slot: 'action', spellId: 'stoneskin', source: 'slot', level: 4, targetIds: [target] });
    const before = call().battle.fighters[2].hp;
    const hit = call('act', { kind: 'resolve', note: 'Weapon damage', targetId: target, effect: 'damage', damageType: 'Slashing', amount: 5 }, gm);
    assert.equal(hit.status, 200);
    assert.equal(hit.battle.fighters[2].hp, before - 2);
  } finally { db.close(); }
});

test('Bane applies only after failed CHA save and modifies real concentration saves', () => {
  const { db, start, call, gm, ally } = setup('bard', 5);
  try {
    chooseTimedSpell(db, 'bane');
    const b = start().battle, target = b.fighters[2].id;
    assert.equal(call('act', { kind: 'cast', slot: 'action', spellId: 'bane', source: 'slot', level: 1, targetIds: [target] }).status, 200);
    call('act', { kind: 'spell-save', targetId: target, roll: 1 }, ally);
    call('act', { kind: 'spell-defense', targetId: target, multiplier: 1 }, gm);
    const applied = call('act', { kind: 'spell-effect', rolls: [] });
    assert.equal(applied.battle.fighters[2].timedEffects[0].spellId, 'bane');
    assert.equal(call('act', { kind: 'saving-throw', actorId: target, ability: 'con', roll: 10 }, ally).status, 409);
    assert.equal(call('act', { kind: 'saving-throw', actorId: target, ability: 'con', roll: 10, baneRoll: 4 }, ally).status, 200);
    call('act', { kind: 'condition', actorId: b.fighters[0].id, condition: 'incapacitated', enabled: true }, gm);
    assert.equal(call().battle.fighters[2].timedEffects.length, 0);
  } finally { db.close(); }
});

test('GM game-time advancement expires effects and rolls back Aid HP without using wall clock', () => {
  const { db, start, call, gm, player } = setup('cleric', 5);
  try {
    chooseTimedSpell(db, 'aid');
    const target = start().battle.fighters[2].id;
    call('act', { kind: 'cast', slot: 'action', spellId: 'aid', source: 'slot', level: 2, targetIds: [target] });
    const advance = user => { let r; handleSpellResources(db, user, '/api/games/1/spell-rest', 'POST', { rest: 'time', seconds: 28800 }, (status, data) => { r = { status, ...data }; }); return r; };
    assert.equal(advance(gm).status, 409);
    call('end', {}, gm);
    assert.equal(advance(player).status, 404);
    assert.equal(advance(gm).status, 200);
    assert.equal(resourceState(db, 2).activeEffects.length, 0);
    assert.equal(JSON.parse(db.prepare('SELECT data FROM character_statistics WHERE character_id = 2').get().data).values.hp, 15);
    assert.equal(start().battle.fighters[2].maxHp, 20);
  } finally { db.close(); }
});

test('concentration ends on the correct round and damage saves include temporary HP damage with DC capped at 30', () => {
  for (const scenario of ['duration', 'damage']) {
    const { db, start, call, gm } = setup('cleric', 5);
    try {
      chooseTimedSpell(db, scenario === 'duration' ? 'bless' : 'shield-of-faith');
      if (scenario === 'damage') {
        const stats = JSON.parse(db.prepare('SELECT data FROM character_statistics WHERE character_id = 1').get().data);
        stats.values.tempHp = 100;
        db.prepare('UPDATE character_statistics SET data = ? WHERE character_id = 1').run(JSON.stringify(stats));
      }
      const b = start().battle;
      call('act', { kind: 'cast', slot: scenario === 'duration' ? 'action' : 'bonus', spellId: scenario === 'duration' ? 'bless' : 'shield-of-faith', source: 'slot', level: 1, targetIds: [b.fighters[2].id] });
      if (scenario === 'duration') {
        for (let i = 0; i < 29; i++) assert.equal(call('next', {}, gm).status, 200);
        assert.equal(call().battle.fighters[2].timedEffects.length, 1);
        const expired = call('next', {}, gm);
        assert.equal(expired.battle.fighters[0].concentration, null);
        assert.equal(expired.battle.fighters[2].timedEffects.length, 0);
      } else {
        const damaged = call('act', { kind: 'resolve', note: 'Damage into temporary HP', targetId: b.fighters[0].id, effect: 'damage', amount: 65 }, gm);
        assert.equal(damaged.battle.fighters[0].hp, 15);
        assert.equal(damaged.battle.fighters[0].concentrationDC, 30);
        assert.equal(call('next', {}, gm).status, 409);
        const failed = call('act', { kind: 'concentration', actorId: b.fighters[0].id, roll: 1 });
        assert.equal(failed.status, 200);
        assert.equal(failed.battle.fighters[2].timedEffects.length, 0);
      }
    } finally { db.close(); }
  }
});

test('starting another concentration spell replaces old effects before new saves, while non-concentration spells preserve them', () => {
  const { db, start, call, gm } = setup('cleric', 5);
  try {
    const stats = JSON.parse(db.prepare('SELECT data FROM character_statistics WHERE character_id = 1').get().data);
    stats.spells.selections = { prepared: ['bless', 'shield-of-faith', 'cure-wounds'] };
    db.prepare('UPDATE character_statistics SET data = ? WHERE character_id = 1').run(JSON.stringify(stats));
    const target = start().battle.fighters[2].id;
    call('act', { kind: 'cast', slot: 'action', spellId: 'bless', source: 'slot', level: 1, targetIds: [target] });
    call('next', {}, gm); call('next', {}, gm); call('next', {}, gm);
    const second = call('act', { kind: 'cast', slot: 'bonus', spellId: 'shield-of-faith', source: 'slot', level: 1, targetIds: [target] });
    assert.equal(second.battle.fighters[2].timedEffects.length, 1);
    assert.equal(second.battle.fighters[2].timedEffects[0].spellId, 'shield-of-faith');
    call('next', {}, gm); call('next', {}, gm); call('next', {}, gm);
    const healing = call('act', { kind: 'cast', slot: 'action', spellId: 'cure-wounds', source: 'slot', level: 1, targetIds: [target] });
    assert.equal(healing.status, 200);
    assert.equal(healing.battle.fighters[2].timedEffects[0].spellId, 'shield-of-faith');
  } finally { db.close(); }
});

test('out-of-combat timed effects use game time, update read-only card stats and can be dismissed by their caster', () => {
  for (const [id, classId, field, value] of [['longstrider', 'wizard', 'speed', 40], ['mage-armor', 'wizard', 'ac', 14], ['aid', 'cleric', 'maxHp', 25]]) {
    const { db, gm, player } = setup(classId, 5);
    const originalNow = Date.now;
    try {
      chooseTimedSpell(db, id);
      let cast;
      handleSpellResources(db, player, '/api/characters/1/spell-resources', 'POST', { kind: 'cast-outside-combat', spellId: id, source: 'slot', level: id === 'aid' ? 2 : 1, confirmed: true, version: resourceState(db, 1).version }, (status, data) => { cast = { status, ...data }; });
      assert.equal(cast.status, 200, id);
      assert.equal(cast.spellcasting.effectiveStats[field], value, id);
      const now = originalNow(); Date.now = () => now + 365 * 86400000;
      assert.equal(publicCaster(db, 1).activeEffects.length, 1, 'Real elapsed time does not advance game time');
      Date.now = originalNow;
      let card;
      handleStatistics(db, player, '/api/characters/1/statistics', 'GET', null, (status, data) => { card = { status, ...data }; });
      assert.equal(card.status, 200);
      assert.equal(card.effective[field], value, id);
      assert.notEqual(card.statistics.values[field], value, 'Base editable stats remain unchanged');
      const effect = publicCaster(db, 1).activeEffects[0];
      let dismissed;
      handleSpellResources(db, player, '/api/characters/1/spell-resources', 'POST', { kind: 'dismiss-effect', castingId: effect.castingId, version: resourceState(db, 1).version }, (status, data) => { dismissed = { status, ...data }; });
      assert.equal(dismissed.status, 200);
      assert.equal(dismissed.spellcasting.activeEffects.length, 0);
      if (id === 'aid') assert.equal(dismissed.spellcasting.effectiveStats.hp, 15);
    } finally { Date.now = originalNow; db.close(); }
  }
});

test('ending concentration while Bane awaits saves cannot create a permanent concentration-free debuff', () => {
  const { db, start, call, gm, ally } = setup('bard', 5);
  try {
    chooseTimedSpell(db, 'bane');
    const b = start().battle, target = b.fighters[2].id;
    call('act', { kind: 'cast', slot: 'action', spellId: 'bane', source: 'slot', level: 1, targetIds: [target] });
    assert.equal(call('act', { kind: 'end-concentration', actorId: b.fighters[0].id }).status, 200);
    call('act', { kind: 'spell-save', targetId: target, roll: 1 }, ally);
    call('act', { kind: 'spell-defense', targetId: target, multiplier: 1 }, gm);
    const finished = call('act', { kind: 'spell-effect', rolls: [] });
    assert.equal(finished.status, 200);
    assert.deepEqual(finished.battle.fighters[2].timedEffects, []);
  } finally { db.close(); }
});

test('dismissing a concentration spell ends its concentration and all targets without spending another action', () => {
  const { db, start, call } = setup('cleric', 5);
  try {
    chooseTimedSpell(db, 'bless');
    const b = start().battle;
    const cast = call('act', { kind: 'cast', slot: 'action', spellId: 'bless', source: 'slot', level: 1, targetIds: [b.fighters[0].id, b.fighters[2].id] });
    const castingId = cast.battle.fighters[2].timedEffects[0].castingId;
    const dismissed = call('act', { kind: 'dismiss-effect', actorId: b.fighters[0].id, castingId });
    assert.equal(dismissed.status, 200);
    assert.equal(dismissed.battle.fighters[0].concentration, null);
    assert.deepEqual(dismissed.battle.fighters[0].timedEffects, []);
    assert.deepEqual(dismissed.battle.fighters[2].timedEffects, []);
    assert.equal(dismissed.battle.fighters[0].action, cast.battle.fighters[0].action);
  } finally { db.close(); }
});

test('expanded direct damage spells use their explicit dice, flat bonuses and saving throws', () => {
  for (const [id, classId, level, count, total] of [['circle-of-death', 'wizard', 6, 8, 8], ['chain-lightning', 'wizard', 6, 10, 10], ['blight', 'wizard', 4, 8, 8], ['disintegrate', 'wizard', 6, 10, 50], ['finger-of-death', 'wizard', 7, 7, 37], ['fire-storm', 'cleric', 7, 7, 7], ['conjure-barrage', 'ranger', 3, 5, 5], ['conjure-volley', 'ranger', 5, 8, 8]]) {
    const { db, start, call, gm } = setup(classId, 20);
    try {
      const stats = JSON.parse(db.prepare('SELECT data FROM character_statistics WHERE character_id = 1').get().data);
      stats.spells.selections = { prepared: [id], ...(classId === 'wizard' ? { book: [id] } : {}) };
      db.prepare('UPDATE character_statistics SET data = ? WHERE character_id = 1').run(JSON.stringify(stats));
      const target = start().battle.fighters[1].id;
      const cast = call('act', { kind: 'cast', slot: 'action', spellId: id, level, source: 'slot', targetIds: [target] });
      assert.equal(cast.status, 200, `${id}: ${cast.error}`);
      assert.equal(cast.battle.pending.spec.dice, count, id);
      call('act', { kind: 'spell-save', targetId: target, roll: 1 }, gm);
      call('act', { kind: 'spell-defense', targetId: target, multiplier: 1 }, gm);
      const resolved = call('act', { kind: 'spell-effect', rolls: Array(count).fill(1) });
      assert.equal(resolved.status, 200, id);
      assert.equal(resolved.battle.fighters[1].damageTaken, total, id);
    } finally { db.close(); }
  }
});

test('multi-beam spells require every target, roll attacks separately and spend resources only once', () => {
  for (const [classId, level, id, circle, beams, dice] of [['warlock', 1, 'eldritch-blast', 0, 1, 1], ['warlock', 5, 'eldritch-blast', 0, 2, 1], ['warlock', 11, 'eldritch-blast', 0, 3, 1], ['warlock', 17, 'eldritch-blast', 0, 4, 1], ['wizard', 5, 'scorching-ray', 3, 4, 2]]) {
    const { db, start, call, gm } = setup(classId, level);
    try {
      if (classId === 'wizard') {
        const stats = JSON.parse(db.prepare('SELECT data FROM character_statistics WHERE character_id = 1').get().data);
        stats.spells.selections = { book: [id], prepared: [id] };
        db.prepare('UPDATE character_statistics SET data = ? WHERE character_id = 1').run(JSON.stringify(stats));
      }
      const target = start().battle.fighters[1].id;
      const body = { kind: 'cast', slot: 'action', spellId: id, source: circle ? 'slot' : 'cantrip', level: circle, targetIds: Array(beams).fill(target) };
      assert.equal(call('act', { ...body, targetIds: Array(beams + 1).fill(target) }).status, 409);
      assert.equal(call('act', body).status, 200);
      for (let i = 0; i < beams; i++) {
        const hit = call('act', { kind: 'spell-attack', roll: 15 });
        assert.equal(hit.status, 200);
        assert.equal(hit.battle.pending.spec.dice, dice);
        call('act', { kind: 'spell-defense', targetId: target, multiplier: 1 }, gm);
        assert.equal(call('act', { kind: 'spell-effect', rolls: Array(dice).fill(1) }).status, 200);
      }
      assert.equal(call().battle.pending, null);
      assert.equal(call().battle.fighters[1].damageTaken, beams * dice);
      assert.equal(resourceState(db, 1).spent.reduce((a, n) => a + n, 0), circle ? 1 : 0);
    } finally { db.close(); }
  }
});

test('mass healing and high-level healing use class modifiers, flat upcasting and maximum HP caps', () => {
  for (const [id, circle, dice, expected] of [['mass-healing-word', 3, 2, 10], ['mass-cure-wounds', 5, 5, 13], ['heal', 6, 0, 75], ['heal', 9, 0, 105], ['power-word-heal', 9, 0, 200]]) {
    const { db, start, call } = setup('cleric', 20);
    try {
      const stats = JSON.parse(db.prepare('SELECT data FROM character_statistics WHERE character_id = 1').get().data);
      stats.spells.selections = { prepared: [id] };
      db.prepare('UPDATE character_statistics SET data = ? WHERE character_id = 1').run(JSON.stringify(stats));
      const ally = JSON.parse(db.prepare('SELECT data FROM character_statistics WHERE character_id = 2').get().data);
      Object.assign(ally.values, { hp: 5, maxHp: 200 });
      db.prepare('UPDATE character_statistics SET data = ? WHERE character_id = 2').run(JSON.stringify(ally));
      const b = start().battle;
      const cast = call('act', { kind: 'cast', slot: id === 'mass-healing-word' ? 'bonus' : 'action', spellId: id, source: 'slot', level: circle, targetIds: [b.fighters[2].id] });
      assert.equal(cast.status, 200, id);
      const result = call('act', { kind: 'spell-effect', rolls: Array(dice).fill(1) });
      assert.equal(result.status, 200, id);
      assert.equal(result.battle.fighters[2].hp, expected, id);
    } finally { db.close(); }
  }
});

test('missed beams do not discard subsequent rays or spend additional actions', () => {
  const { db, start, call, gm } = setup('warlock', 5);
  try {
    const target = start().battle.fighters[1].id;
    call('act', { kind: 'cast', slot: 'action', spellId: 'eldritch-blast', source: 'cantrip', level: 0, targetIds: [target, target] });
    assert.equal(call('act', { kind: 'spell-attack', roll: 1 }).battle.pending.stage, 'attack');
    assert.equal(call('act', { kind: 'spell-attack', roll: 20 }).battle.pending.critical, true);
    call('act', { kind: 'spell-defense', targetId: target, multiplier: 1 }, gm);
    const result = call('act', { kind: 'spell-effect', rolls: [2, 3] });
    assert.equal(result.status, 200);
    assert.equal(result.battle.pending, null);
    assert.equal(result.battle.fighters[1].damageTaken, 5);
  } finally { db.close(); }
});

test('outside-combat spells support long casting, wizard book rituals, optimistic versions and combat blocking', () => {
  const { db, start } = setup('wizard', 5);
  try {
    const stats = JSON.parse(db.prepare('SELECT data FROM character_statistics WHERE character_id = 1').get().data);
    stats.spells.selections = { book: ['alarm', 'identify'], prepared: ['alarm'] };
    db.prepare('UPDATE character_statistics SET data = ? WHERE character_id = 1').run(JSON.stringify(stats));
    const user = { id: 2, role: 'player' };
    const cast = body => { let result; handleSpellResources(db, user, '/api/characters/1/spell-resources', 'POST', { kind: 'cast-outside-combat', confirmed: true, ...body }, (status, data) => { result = { status, ...data }; }); return result; };
    const initial = resourceState(db, 1).version;
    const ritual = cast({ spellId: 'identify', level: 1, source: 'ritual', version: initial });
    assert.equal(ritual.status, 200);
    assert.equal(resourceState(db, 1).spent[0], 0);
    assert.throws(() => spendSpell(db, 1, 'identify', 1, 'slot'));
    assert.equal(cast({ spellId: 'identify', level: 1, source: 'ritual', version: initial }).status, 409);
    const version = ritual.spellcasting.resourceVersion;
    assert.equal(cast({ spellId: 'alarm', level: 1, source: 'slot', version }).status, 200);
    assert.equal(resourceState(db, 1).spent[0], 1);
    assert.equal(resourceState(db, 1).castHistory.length, 2);
    start();
    assert.equal(cast({ spellId: 'identify', level: 1, source: 'ritual', version: resourceState(db, 1).version }).status, 409);
  } finally { db.close(); }
});

function configureTiefling(db, legacy = 'infernal') {
  db.prepare('UPDATE characters SET species = ? WHERE id = 1').run('Diabelstwo (Tiefling)');
  const stats = JSON.parse(db.prepare('SELECT data FROM character_statistics WHERE character_id = 1').get().data);
  stats.traits = { tieflingLegacy: [legacy], tieflingSpellAbility: ['cha'], tieflingSize: ['medium'] };
  stats.spells.selections.cantrips = [];
  db.prepare('UPDATE character_statistics SET data = ? WHERE character_id = 1').run(JSON.stringify(stats));
}

test('False Life grants self-only non-stacking temporary HP and upcasts by a flat five', () => {
  for (const level of [1, 3]) {
    const { db, start, call } = setup('wizard', 5);
    try {
      configureTiefling(db, 'chthonic');
      const b = start().battle;
      const result = call('act', { kind: 'cast', slot: 'action', spellId: 'false-life', source: level === 1 ? 'legacy' : 'slot', level, targetIds: [b.fighters[2].id] });
      assert.equal(result.status, 200);
      assert.deepEqual(result.battle.pending.targets.map(t => t.id), [b.fighters[0].id]);
      assert.equal(result.battle.pending.spec.dice, 2);
      const resolved = call('act', { kind: 'spell-effect', rolls: [2, 4] });
      assert.equal(resolved.status, 200);
      assert.equal(resolved.battle.fighters[0].tempHp, 10 + 5 * (level - 1));
      assert.equal(resolved.battle.fighters[2].tempHp, 0);
      assert.equal(JSON.parse(db.prepare('SELECT data FROM character_statistics WHERE character_id = 1').get().data).values.tempHp, 10 + 5 * (level - 1));
    } finally { db.close(); }
  }
});

test('False Life preserves a larger existing temporary HP pool', () => {
  const { db, start, call } = setup('wizard', 5);
  try {
    configureTiefling(db, 'chthonic');
    const stats = JSON.parse(db.prepare('SELECT data FROM character_statistics WHERE character_id = 1').get().data);
    stats.values.tempHp = 30;
    db.prepare('UPDATE character_statistics SET data = ? WHERE character_id = 1').run(JSON.stringify(stats));
    start();
    call('act', { kind: 'cast', slot: 'action', spellId: 'false-life', source: 'legacy', level: 1 });
    assert.equal(call('act', { kind: 'spell-effect', rolls: [4, 4] }).battle.fighters[0].tempHp, 30);
  } finally { db.close(); }
});

test('concentration conditions expire in initiative order, and a replacement casting ends old effects', () => {
  const source = { id: 'source', hp: 10, concentration: 'Hold Person', concentrationKey: 'old', concentrationExpiresRound: 11 };
  const target = { id: 'target', spellConditions: [{ kind: 'paralyzed', sourceId: 'source', concentrationKey: 'old', expiresRound: 11 }] };
  const b = { round: 11, turn: 0, fighters: [target, source] };
  syncSpellConditions(b);
  assert.equal(target.spellConditions.length, 1);
  source.concentrationKey = 'replacement';
  syncSpellConditions(b);
  assert.deepEqual(target.spellConditions, []);
  b.turn = 1;
  syncSpellConditions(b);
  assert.equal(source.concentration, null);
});

test('Enfeeblement requires a separate valid d8 for each damage roll and never affects an unweakened caster', () => {
  const weakened = { spellConditions: [{ kind: 'enfeebled' }] };
  for (const roll of [undefined, 0, 9, 1.5]) assert.throws(() => enfeeblementReduction(weakened, roll));
  assert.equal(enfeeblementReduction(weakened, 8), 8);
  assert.equal(enfeeblementReduction({}, undefined), 0);
});

test('Chill Touch scales, blocks healing and expires at the end of the caster next turn', () => {
  const { db, start, call, gm, ally } = setup('wizard', 5);
  try {
    configureTiefling(db, 'chthonic');
    const b = start().battle, id = b.fighters[2].id;
    assert.equal(call('act', { kind: 'cast', slot: 'action', spellId: 'chill-touch', source: 'cantrip', level: 0, targetIds: [id] }).status, 200);
    call('act', { kind: 'spell-attack', roll: 15 });
    call('act', { kind: 'spell-defense', targetId: id, multiplier: 1 }, gm);
    const hit = call('act', { kind: 'spell-effect', rolls: [1, 1] });
    assert.equal(hit.status, 200);
    assert.equal(hit.battle.fighters[2].spellConditions[0].kind, 'chill-touch');
    assert.equal(call('act', { kind: 'resolve', note: 'Heal', targetId: id, effect: 'heal', amount: 1 }, gm).status, 409);
    call('next', {}, gm); call('next', {}, gm); call('next', {}, ally);
    assert.equal(call('act', { kind: 'resolve', note: 'Still blocked', targetId: id, effect: 'heal', amount: 1 }, gm).status, 409);
    call('next', {}, gm);
    assert.equal(call('act', { kind: 'resolve', note: 'Expired', targetId: id, effect: 'heal', amount: 1 }, gm).status, 200);
  } finally { db.close(); }
});

test('Ray of Sickness applies Poisoned on hit without a save and respects separate condition immunity', () => {
  for (const conditionImmune of [false, true]) {
    const { db, start, call, gm } = setup('wizard', 3);
    try {
      configureTiefling(db, 'abyssal');
      const id = start().battle.fighters[1].id;
      call('act', { kind: 'cast', slot: 'action', spellId: 'ray-of-sickness', source: 'legacy', level: 1, targetIds: [id] });
      const hit = call('act', { kind: 'spell-attack', roll: 15 });
      assert.equal(hit.battle.pending.stage, 'effect');
      call('act', { kind: 'spell-defense', targetId: id, multiplier: 0, conditionImmune }, gm);
      assert.equal(call('act', { kind: 'spell-effect', rolls: [1, 1] }).status, 200);
      call('next', {}, gm);
      const attack = { name: 'Claw', bonus: 5, dice: 1, sides: 6, damageBonus: 0 };
      const result = call('act', { kind: 'attack', slot: 'action', targetId: call().battle.fighters[0].id, attack, roll: 2 }, gm);
      assert.equal(result.status, conditionImmune ? 200 : 409);
    } finally { db.close(); }
  }
});

test('Hold Person requires a Humanoid, paralyzes, repeats saves, and ends when concentration breaks', () => {
  for (const breakConcentration of [false, true]) {
    const { db, start, call, gm, ally } = setup('wizard', 5);
    try {
      configureTiefling(db, 'abyssal');
      const b = start().battle, id = b.fighters[2].id;
      const cast = { kind: 'cast', slot: 'action', spellId: 'hold-person', source: 'legacy', level: 2, targetIds: [id] };
      assert.equal(call('act', cast).status, 409);
      assert.equal(publicCaster(db, 1).spells.find(s => s.id === 'hold-person').legacyFreeCast, true);
      assert.equal(call('act', { ...cast, confirmedHumanoid: true }).status, 200);
      call('act', { kind: 'spell-save', targetId: id, roll: 1 }, ally);
      call('act', { kind: 'spell-defense', targetId: id, multiplier: 1 }, gm);
      const applied = call('act', { kind: 'spell-effect', rolls: [] });
      assert.equal(applied.status, 200);
      assert.equal(hasCondition(applied.battle.fighters[2], 'paralyzed'), true);
      if (breakConcentration) {
        assert.equal(call('act', { kind: 'condition', actorId: b.fighters[0].id, condition: 'incapacitated', enabled: true }, gm).status, 200);
        assert.deepEqual(call().battle.fighters[2].spellConditions, []);
      } else {
        call('next', {}, gm); call('next', {}, gm);
        assert.equal(call('act', { kind: 'move', feet: 5 }, ally).status, 409);
        assert.equal(call('next', {}, ally).status, 409);
        assert.equal(call('act', { kind: 'condition-save', actorId: id, sourceId: b.fighters[0].id, condition: 'paralyzed', roll: 20 }, ally).status, 200);
        assert.deepEqual(call().battle.fighters[2].spellConditions, []);
        assert.equal(call('next', {}, ally).status, 200);
      }
    } finally { db.close(); }
  }
});

test('Ray of Enfeeblement applies different effects on failed and successful Constitution saves', () => {
  for (const roll of [1, 20]) {
    const { db, start, call, gm, ally } = setup('wizard', 5);
    try {
      configureTiefling(db, 'chthonic');
      const b = start().battle, id = b.fighters[2].id;
      assert.equal(call('act', { kind: 'cast', slot: 'action', spellId: 'ray-of-enfeeblement', source: 'legacy', level: 2, targetIds: [id] }).status, 200);
      assert.equal(call('act', { kind: 'spell-save', targetId: id, roll }, ally).status, 200);
      call('act', { kind: 'spell-defense', targetId: id, multiplier: 1 }, gm);
      const applied = call('act', { kind: 'spell-effect', rolls: [] });
      assert.equal(applied.status, 200);
      assert.equal(applied.battle.fighters[2].spellConditions[0].kind, roll === 1 ? 'enfeebled' : 'enfeebled-miss');
      call('next', {}, gm); call('next', {}, gm);
      if (roll === 1) {
        assert.equal(call('act', { kind: 'ability-check', ability: 'str', roll: 10 }, ally).status, 409);
        assert.equal(call('act', { kind: 'ability-check', ability: 'str', roll: 10, roll2: 11 }, ally).status, 200);
      }
      assert.equal(call('act', { kind: 'attack', slot: 'action', attackId: 'unarmed', targetId: b.fighters[1].id, roll: 20 }, ally).status, 409);
      const attack = call('act', { kind: 'attack', slot: 'action', attackId: 'unarmed', targetId: b.fighters[1].id, roll: 20, roll2: 20 }, ally);
      assert.equal(attack.status, 200);
      const hit = call('act', { kind: 'damage', rolls: [], enfeeblementRoll: 8 }, ally);
      assert.equal(hit.status, 200);
      if (roll === 1) assert.equal(hit.battle.fighters[1].damageTaken, 0);
      else assert.deepEqual(hit.battle.fighters[2].spellConditions, []);
    } finally { db.close(); }
  }
});

test('all Tiefling legacies halve matching GM damage once, accept both type labels, and preserve other damage', () => {
  for (const [legacy, english, polish] of [['infernal', 'Fire', 'ogień'], ['abyssal', 'Poison', 'trucizna'], ['chthonic', 'Necrotic', 'nekrotyczne']]) {
    const { db, start, call, gm } = setup('wizard', 5);
    try {
      configureTiefling(db, legacy);
      const fighter = start().battle.fighters[0];
      assert.equal(fighter.creatureType, 'Humanoid');
      assert.equal(fighter.damageResistance, polish);
      for (const type of [english, polish, 'Cold']) {
        const before = call().battle.fighters[0].hp;
        const result = call('act', { kind: 'resolve', note: 'Typed damage', targetId: fighter.id, effect: 'damage', amount: 5, damageType: type }, gm);
        assert.equal(result.status, 200);
        assert.equal(result.battle.fighters[0].hp, before - (type === 'Cold' ? 5 : 2));
      }
    } finally { db.close(); }
  }
});

test('automated spells apply every Tiefling resistance once even when GM also selects resistance', () => {
  for (const [legacy, classId, spellId, save, rolls] of [['infernal', 'wizard', 'fire-bolt', false, [5]], ['abyssal', 'wizard', 'poison-spray', false, [5]], ['chthonic', 'cleric', 'inflict-wounds', true, [2, 3]]]) {
    for (const multiplier of [1, 0.5]) {
      const { db, start, call, gm, ally } = setup(classId);
      try {
        db.prepare('UPDATE characters SET species = ? WHERE id = 2').run('Diabelstwo (Tiefling)');
        const targetStats = JSON.parse(db.prepare('SELECT data FROM character_statistics WHERE character_id = 2').get().data);
        targetStats.traits = { tieflingLegacy: [legacy], tieflingSpellAbility: ['cha'], tieflingSize: ['medium'] };
        db.prepare('UPDATE character_statistics SET data = ? WHERE character_id = 2').run(JSON.stringify(targetStats));
        if (save) {
          const stats = JSON.parse(db.prepare('SELECT data FROM character_statistics WHERE character_id = 1').get().data);
          stats.spells.selections = { prepared: [spellId] };
          db.prepare('UPDATE character_statistics SET data = ? WHERE character_id = 1').run(JSON.stringify(stats));
        }
        const target = start().battle.fighters[2];
        assert.equal(call('act', { kind: 'cast', slot: 'action', spellId, source: save ? 'slot' : 'cantrip', level: save ? 1 : 0, targetIds: [target.id] }).status, 200);
        assert.equal((save ? call('act', { kind: 'spell-save', targetId: target.id, roll: 1 }, ally) : call('act', { kind: 'spell-attack', roll: 15 })).status, 200);
        assert.equal(call('act', { kind: 'spell-defense', targetId: target.id, multiplier }, gm).status, 200);
        const result = call('act', { kind: 'spell-effect', rolls });
        assert.equal(result.status, 200);
        assert.equal(result.battle.fighters[2].hp, target.hp - 2);
      } finally { db.close(); }
    }
  }
});

test('each legacy spell has an independent free cast at the right level, restored only by a long rest', () => {
  for (const [legacy, first, second] of [['infernal', 'hellish-rebuke', 'darkness'], ['abyssal', 'ray-of-sickness', 'hold-person'], ['chthonic', 'false-life', 'ray-of-enfeeblement']]) {
    for (const level of [1, 3, 5]) {
      const { db, rest } = setup('wizard', level);
      try {
        configureTiefling(db, legacy);
        db.prepare('UPDATE characters SET class = ? WHERE id = 1').run('Wojownik (Fighter)');
        const stats = JSON.parse(db.prepare('SELECT data FROM character_statistics WHERE character_id = 1').get().data);
        stats.spells = emptyStatistics().spells;
        db.prepare('UPDATE character_statistics SET data = ? WHERE character_id = 1').run(JSON.stringify(stats));
        assert.deepEqual(publicCaster(db, 1).slots, []);
        const available = [[first, 1, 3], [second, 2, 5]].filter(([, , required]) => level >= required);
        for (const [id, circle] of available) {
          assert.equal(publicCaster(db, 1).spells.find(s => s.id === id).legacyFreeCast, true);
          assert.throws(() => spendSpell(db, 1, id, circle + 1, 'legacy'));
          assert.equal(publicCaster(db, 1).spells.find(s => s.id === id).legacyFreeCast, true);
          spendSpell(db, 1, id, circle, 'legacy');
          assert.throws(() => spendSpell(db, 1, id, circle, 'legacy'));
        }
        for (const [id, circle, required] of [[first, 1, 3], [second, 2, 5]]) {
          if (level < required) assert.throws(() => spendSpell(db, 1, id, circle, 'legacy'));
        }
        assert.equal(rest('short').status, 200);
        for (const [id] of available) assert.equal(publicCaster(db, 1).spells.find(s => s.id === id).legacyFreeCast, false);
        assert.equal(rest('long').status, 200);
        for (const [id] of available) assert.equal(publicCaster(db, 1).spells.find(s => s.id === id).legacyFreeCast, true);
        assert.throws(() => spendSpell(db, 1, 'thaumaturgy', 0, 'legacy'));
      } finally { db.close(); }
    }
  }
});

test('Tiefling explicitly chooses slots or free casts and can upcast with ordinary or pact slots', () => {
  for (const [classId, source] of [['wizard', 'slot'], ['warlock', 'pact']]) {
    const { db } = setup(classId, 5);
    try {
      configureTiefling(db);
      const before = resourceState(db, 1);
      spendSpell(db, 1, 'hellish-rebuke', 3, source);
      assert.equal(publicCaster(db, 1).spells.find(s => s.id === 'hellish-rebuke').legacyFreeCast, true);
      const afterSlot = resourceState(db, 1);
      assert.equal(source === 'slot' ? afterSlot.spent[2] : afterSlot.pactSpent, (source === 'slot' ? before.spent[2] : before.pactSpent) + 1);
      spendSpell(db, 1, 'hellish-rebuke', 1, 'legacy');
      assert.deepEqual(resourceState(db, 1).spent, afterSlot.spent);
      assert.equal(resourceState(db, 1).pactSpent, afterSlot.pactSpent);
      assert.equal(publicCaster(db, 1).spells.find(s => s.id === 'darkness').legacyFreeCast, true);
      assert.throws(() => spendSpell(db, 1, 'shield', 1, 'legacy'));
    } finally { db.close(); }
  }
});

test('a legacy reaction after a slotted spell does not consume or count as another slot', () => {
  const { db, start, call, gm } = setup('wizard', 5);
  try {
    configureTiefling(db);
    const b = start().battle;
    assert.equal(call('act', { kind: 'cast', slot: 'action', spellId: 'magic-missile', source: 'slot', level: 1 }).status, 200);
    assert.equal(call('act', { kind: 'resolve', note: 'Spell effects confirmed' }, gm).status, 200);
    const before = resourceState(db, 1).spent;
    const reaction = call('act', { kind: 'cast', actorId: b.fighters[0].id, slot: 'reaction', spellId: 'hellish-rebuke', source: 'legacy', level: 1, targetIds: [b.fighters[1].id] });
    assert.equal(reaction.status, 200);
    assert.deepEqual(reaction.battle.slotCasters, [b.fighters[0].id]);
    assert.deepEqual(resourceState(db, 1).spent, before);
    assert.match(reaction.battle.log.join('\n'), /Fiendish Legacy/);
    assert.equal(call('act', { kind: 'spell-save', targetId: b.fighters[1].id, roll: 20 }, gm).status, 200);
    assert.equal(call('act', { kind: 'spell-defense', targetId: b.fighters[1].id, multiplier: 1 }, gm).status, 200);
    assert.equal(call('act', { kind: 'spell-effect', rolls: [5, 6] }).status, 200);
  } finally { db.close(); }
});

test('Tiefling wizard casts racial and class spells using their own abilities', () => {
  const { db, start, call } = setup('wizard', 5);
  try {
    db.prepare('UPDATE characters SET species = ? WHERE id = 1').run('Diabelstwo (Tiefling)');
    const stats = JSON.parse(db.prepare('SELECT data FROM character_statistics WHERE character_id = 1').get().data);
    Object.assign(stats.values, { int: 18, cha: 10 });
    stats.traits = { tieflingLegacy: ['infernal'], tieflingSpellAbility: ['cha'], tieflingSize: ['medium'] };
    stats.spells.selections.cantrips = ['poison-spray'];
    db.prepare('UPDATE character_statistics SET data = ? WHERE character_id = 1').run(JSON.stringify(stats));
    const caster = publicCaster(db, 1);
    assert.equal(caster.attack, 7);
    assert.equal(caster.dc, 15);
    for (const id of ['fire-bolt', 'thaumaturgy', 'hellish-rebuke', 'darkness']) {
      const spell = caster.spells.find(spell => spell.id === id);
      assert.equal(spell.spellcastingAbility, 'cha');
      assert.equal(spell.attack, 3);
      assert.equal(spell.dc, 11);
    }
    assert.equal(spendSpell(db, 1, 'poison-spray', 0, 'cantrip').attack, 7);
    assert.equal(spendSpell(db, 1, 'burning-hands', 1, 'slot').dc, 15);
    assert.equal(spendSpell(db, 1, 'fire-bolt', 0, 'cantrip').attack, 3);
    const battle = start().battle;
    const cast = call('act', { kind: 'cast', slot: 'action', spellId: 'fire-bolt', source: 'cantrip', level: 0, targetIds: [battle.fighters[1].id] });
    assert.equal(cast.status, 200);
    assert.equal(cast.battle.pending.attackBonus, 3);
  } finally { db.close(); }
});

test('missing Tiefling ability score does not fall back to the wizard ability', () => {
  const { db } = setup('wizard');
  try {
    db.prepare('UPDATE characters SET species = ? WHERE id = 1').run('Diabelstwo (Tiefling)');
    const stats = JSON.parse(db.prepare('SELECT data FROM character_statistics WHERE character_id = 1').get().data);
    stats.values.cha = null;
    stats.traits = { tieflingLegacy: ['infernal'], tieflingSpellAbility: ['cha'] };
    stats.spells.selections.cantrips = ['poison-spray'];
    db.prepare('UPDATE character_statistics SET data = ? WHERE character_id = 1').run(JSON.stringify(stats));
    const racial = spendSpell(db, 1, 'fire-bolt', 0, 'cantrip');
    assert.equal(racial.ability, null);
    assert.equal(racial.attack, null);
    assert.equal(racial.dc, null);
    assert.equal(spendSpell(db, 1, 'poison-spray', 0, 'cantrip').attack, 5);
  } finally { db.close(); }
});

test('Origin spells use the selected ability and one free cast, renewed by a long rest', () => {
  const { db, gm } = setup('wizard');
  try {
    db.prepare('UPDATE characters SET species = ? WHERE id = 1').run('Człowiek (Human)');
    const stats = JSON.parse(db.prepare('SELECT data FROM character_statistics WHERE character_id = 1').get().data);
    stats.values.cha = 20;
    stats.traits = { humanFeat: ['Magic Initiate (Wizard)'], 'origin:Magic Initiate (Wizard):ability': ['cha'], 'origin:Magic Initiate (Wizard):spell': ['witch-bolt'] };
    db.prepare('UPDATE character_statistics SET data = ? WHERE character_id = 1').run(JSON.stringify(stats));
    assert.equal(publicCaster(db, 1).spells.find(s => s.id === 'witch-bolt').originFreeCast, true);
    const cast = spendSpell(db, 1, 'witch-bolt', 1, 'origin');
    assert.equal(cast.ability, 5);
    assert.equal(cast.dc, 15);
    assert.equal(publicCaster(db, 1).spells.find(s => s.id === 'witch-bolt').originFreeCast, false);
    assert.throws(() => spendSpell(db, 1, 'witch-bolt', 1, 'origin'));
    assert.doesNotThrow(() => spendSpell(db, 1, 'witch-bolt', 1, 'slot'));
    let result;
    handleSpellResources(db, gm, '/api/games/1/spell-rest', 'POST', { rest: 'long' }, (status, data) => { result = { status, ...data }; });
    assert.equal(result.status, 200);
    assert.equal(publicCaster(db, 1).spells.find(s => s.id === 'witch-bolt').originFreeCast, true);
  } finally { db.close(); }
});

test('Danger Sense applies to spell Dexterity saves without Rage and is disabled by Incapacitated', () => {
  for (const incapacitated of [false, true]) {
    const { db, call, start, gm, ally } = setup('wizard');
    try {
      db.prepare('UPDATE characters SET class = ?, level = 2 WHERE id = 2').run('Barbarzyńca (Barbarian)');
      const id = start().battle.fighters[2].id;
      if (incapacitated) assert.equal(call('act', { kind: 'condition', actorId: id, condition: 'incapacitated', enabled: true }, gm).status, 200);
      const cast = call('act', { kind: 'cast', slot: 'action', spellId: 'burning-hands', source: 'slot', level: 1, targetIds: [id] });
      assert.equal(cast.status, 200); assert.equal(cast.battle.pending.stage, 'save');
      const single = call('act', { kind: 'spell-save', targetId: id, roll: 18 }, ally);
      assert.equal(single.status, incapacitated ? 200 : 409);
      if (!incapacitated) {
        const saved = call('act', { kind: 'spell-save', targetId: id, roll: 1, roll2: 18 }, ally);
        assert.equal(saved.status, 200); assert.equal(saved.battle.pending.targets[0].saved, true);
      }
    } finally { db.close(); }
  }
});

test('spell attacks against a reckless barbarian automatically have advantage', () => {
  const { db, call, start, gm, ally } = setup('wizard');
  try {
    db.prepare('UPDATE characters SET class = ?, level = 2 WHERE id = 2').run('Barbarzyńca (Barbarian)');
    const b = start().battle, id = b.fighters[2].id;
    call('next', {}, gm); call('next', {}, gm);
    assert.equal(call('act', { kind: 'attack', slot: 'action', attackId: 'unarmed', targetId: b.fighters[1].id, reckless: true, roll: 1, roll2: 2 }, ally).status, 200);
    call('next', {}, ally);
    assert.equal(call('act', { kind: 'cast', slot: 'action', spellId: 'fire-bolt', source: 'cantrip', level: 0, targetIds: [id] }).status, 200);
    assert.equal(call('act', { kind: 'spell-attack', roll: 1 }).status, 409);
    const hit = call('act', { kind: 'spell-attack', roll: 1, roll2: 19 });
    assert.equal(hit.status, 200); assert.equal(hit.battle.pending.stage, 'effect');
    assert.equal(hit.battle.fighters[0].attackRollMade, true);
  } finally { db.close(); }
});

function setup(classId = 'bard', level = 3) {
  const db = openDatabase(':memory:');
  db.exec(`INSERT INTO users VALUES (1,'gm','GM','unused','gm'),(2,'mage','Mage','unused','player'),(3,'target','Target','unused','player');
    INSERT INTO games (id,gm_id,name) VALUES (1,1,'Magic game');
    INSERT INTO game_sessions (id,game_id,started_at) VALUES (1,1,1);
    INSERT INTO characters (id,user_id,name,class,level) VALUES (1,2,'Caster','Bard',3),(2,3,'Ally','Bard',1);
    INSERT INTO game_members (id,game_id,character_id,status) VALUES (1,1,1,'accepted'),(2,1,2,'accepted');
    INSERT INTO session_participants VALUES (1,1,1),(1,2,1);
    INSERT INTO game_monster_entries VALUES (1,'enemy','Enemy',100,14,30,'','{"str":1,"dex":1,"con":1,"int":1,"wis":1,"cha":1}');`);
  db.prepare('UPDATE characters SET class = ?, level = ? WHERE id = 1').run(progression[classId].name, level);
  const s = emptyStatistics(); Object.assign(s.values, { str: 10, dex: 12, con: 14, int: 16, wis: 16, cha: 16, hp: 15, maxHp: 20, tempHp: 0, ac: 12, speed: 30 });
  if (classId === 'bard') s.spells.selections = { cantrips: ['vicious-mockery', 'thunderclap'], prepared: ['cure-wounds', 'healing-word', 'thunderwave', 'faerie-fire', 'dissonant-whispers'] };
  if (classId === 'wizard') s.spells.selections = { cantrips: ['fire-bolt', 'poison-spray'], book: ['burning-hands', 'magic-missile', 'shield'], prepared: ['burning-hands', 'magic-missile', 'shield'] };
  if (classId === 'warlock') s.spells.selections = { cantrips: ['eldritch-blast'], prepared: ['hellish-rebuke'], ...(level >= 11 ? { arcanum6: ['circle-of-death'] } : {}) };
  db.prepare('INSERT INTO character_statistics VALUES (1, ?)').run(JSON.stringify(s));
  db.prepare('INSERT INTO character_statistics VALUES (2, ?)').run(JSON.stringify({ ...s, spells: emptyStatistics().spells }));
  const gm = { id: 1, role: 'gm' }, player = { id: 2, role: 'player' }, ally = { id: 3, role: 'player' };
  let version = 0;
  const call = (action = '', body = {}, user = player) => {
    let result;
    handleBattles(db, user, `/api/games/1/battle${action ? '/' + action : ''}`, action ? 'POST' : 'GET', { sessionId: 1, version, ...body }, (status, data) => { result = { status, ...data }; });
    if (result.battle) version = result.battle.version;
    return result;
  };
  const start = () => call('start', { fighters: [{ memberId: 1, initiative: 20 }, { enemyId: 'enemy', initiative: 10 }, { memberId: 2, initiative: 5 }] }, gm);
  const rest = (type, user = gm) => {
    let result;
    handleSpellResources(db, user, '/api/games/1/spell-rest', 'POST', { rest: type }, (status, data) => { result = { status, ...data }; });
    return result;
  };
  return { db, gm, player, ally, call, start, rest };
}

test('only available spells can be cast; healing/upcasting, one slot per turn, cantrips and persistence work together', () => {
  const { db, call, start, gm } = setup();
  try {
    const b = start().battle, self = b.fighters[0].id, enemy = b.fighters[1].id;
    assert.equal(call('act', { kind: 'cast', slot: 'action', spellId: 'fireball', source: 'slot', level: 3, targetIds: [enemy] }).status, 409);
    assert.equal(call('act', { kind: 'cast', slot: 'action', spellId: 'healing-word', source: 'slot', level: 1, targetIds: [self] }).status, 409);
    assert.equal(resourceState(db, 1).spent[0], 0);
    const heal = call('act', { kind: 'cast', slot: 'bonus', spellId: 'healing-word', source: 'slot', level: 2, targetIds: [self] });
    assert.equal(heal.status, 200); assert.equal(heal.battle.pending.spec.dice, 4);
    assert.equal(resourceState(db, 1).spent[1], 1);
    assert.equal(call('act', { kind: 'spell-effect', rolls: [1, 1, 1, 1] }).battle.fighters[0].hp, 20);
    assert.equal(call('act', { kind: 'cast', slot: 'action', spellId: 'cure-wounds', source: 'slot', level: 1, targetIds: [self] }).status, 409);
    assert.equal(resourceState(db, 1).spent[0], 0);
    const cantrip = call('act', { kind: 'cast', slot: 'action', spellId: 'vicious-mockery', source: 'cantrip', level: 0, targetIds: [enemy] });
    assert.equal(cantrip.status, 200);
    assert.equal(call('act', { kind: 'spell-save', targetId: enemy, roll: 20 }, gm).battle.pending, null);
    call('end', {}, gm); const nextBattle = start().battle;
    assert.equal(publicCaster(db, 1).slots.find(s => s.level === 2).remaining, 1);
    const restored = hydrate(exportRows(db));
    try { assert.equal(resourceState(restored, 1).spent[1], 1); } finally { restored.close(); }
  } finally { db.close(); }
});

test('spell attacks use spellcasting ability and cantrip level scaling; critical hits double only dice', () => {
  const { db, call, start, gm } = setup('wizard', 5);
  try {
    const b = start().battle;
    const cast = call('act', { kind: 'cast', slot: 'action', spellId: 'fire-bolt', source: 'cantrip', level: 0, targetIds: [b.fighters[1].id] });
    assert.equal(cast.battle.pending.spec.dice, 2);
    assert.equal(cast.battle.pending.attackBonus, 6);
    assert.equal(call('act', { kind: 'spell-attack', roll: 20 }).battle.pending.critical, true);
    call('act', { kind: 'spell-defense', targetId: b.fighters[1].id, multiplier: 1 }, gm);
    assert.equal(call('act', { kind: 'spell-effect', rolls: [10, 10] }).status, 409);
    const hit = call('act', { kind: 'spell-effect', rolls: [10, 10, 10, 10] });
    assert.equal(hit.battle.fighters[1].damageTaken, 40);
    assert.equal(call('act', { kind: 'spell-effect', rolls: [10, 10, 10, 10] }).status, 409);
    assert.equal(resourceState(db, 1).spent.reduce((a, n) => a + n, 0), 0);
  } finally { db.close(); }
});

test('area spells use one damage roll, separate authorized saving throws and rounded-down half damage', () => {
  const { db, call, start, gm, ally } = setup('wizard');
  try {
    const b = start().battle, enemy = b.fighters[1].id, friend = b.fighters[2].id;
    const cast = call('act', { kind: 'cast', slot: 'action', spellId: 'burning-hands', source: 'slot', level: 2, targetIds: [enemy, friend] });
    assert.equal(cast.battle.pending.spec.dice, 4);
    assert.equal(call('act', { kind: 'spell-save', targetId: enemy, roll: 20 }).status, 409);
    assert.equal(call('act', { kind: 'spell-save', targetId: friend, roll: 20 }, gm).status, 409);
    call('act', { kind: 'spell-save', targetId: enemy, roll: 20 }, gm);
    assert.equal(call('act', { kind: 'spell-save', targetId: friend, roll: 1 }, ally).battle.pending.stage, 'effect');
    call('act', { kind: 'spell-defense', targetId: enemy, multiplier: 1 }, gm);
    call('act', { kind: 'spell-defense', targetId: friend, multiplier: 1 }, gm);
    const hit = call('act', { kind: 'spell-effect', rolls: [1, 1, 2, 3] });
    assert.equal(hit.battle.fighters[1].damageTaken, 3);
    assert.equal(hit.battle.fighters[2].hp, 8);
    assert.equal(JSON.parse(db.prepare('SELECT data FROM character_statistics WHERE character_id = 2').get().data).values.hp, 8);
  } finally { db.close(); }
});

test('GM alone confirms damage defenses; hidden immunity prevents damage without exposing monster statistics', () => {
  const { db, call, start, gm } = setup('wizard');
  try {
    const enemy = start().battle.fighters[1].id;
    call('act', { kind: 'cast', slot: 'action', spellId: 'poison-spray', source: 'cantrip', level: 0, targetIds: [enemy] });
    call('act', { kind: 'spell-attack', roll: 15 });
    assert.equal(call('act', { kind: 'spell-effect', rolls: [12] }).status, 409);
    assert.equal(call('act', { kind: 'spell-defense', targetId: enemy, multiplier: 0 }).status, 409);
    call('act', { kind: 'spell-defense', targetId: enemy, multiplier: 0 }, gm);
    assert.equal(call().battle.pending.targets[0].multiplier, undefined);
    const resolved = call('act', { kind: 'spell-effect', rolls: [12] });
    assert.equal(resolved.battle.fighters[1].damageTaken, 0);
    assert.equal(resolved.battle.fighters[1].hp, undefined);
  } finally { db.close(); }
});

test('long rests restore ordinary slots; short rests only restore Pact Magic, never Mystic Arcanum', () => {
  for (const classId of ['bard', 'warlock']) {
    const { db, call, start, gm, rest, player } = setup(classId, classId === 'warlock' ? 11 : 3);
    try {
      const b = start().battle;
      const body = classId === 'bard' ? { spellId: 'cure-wounds', source: 'slot', level: 1, slot: 'action', targetIds: [b.fighters[0].id] }
        : { spellId: 'hellish-rebuke', source: 'pact', level: 5, slot: 'reaction', targetIds: [b.fighters[1].id] };
      assert.equal(call('act', { kind: 'cast', ...body }).status, 200);
      assert.equal(rest('long').status, 409);
      call('end', {}, gm);
      assert.equal(rest('long', player).status, 404);
      assert.equal(rest('short').status, 200);
      assert.equal(resourceState(db, 1).spent[0], classId === 'bard' ? 1 : 0);
      assert.equal(resourceState(db, 1).pactSpent, 0);
      if (classId === 'warlock') {
        const restart = start().battle;
        assert.equal(call('act', { kind: 'cast', slot: 'action', spellId: 'circle-of-death', source: 'arcanum', level: 6, targetIds: [restart.fighters[1].id] }).status, 200);
        call('end', {}, gm); rest('short');
        assert.equal(resourceState(db, 1).arcanum['circle-of-death'], true);
      }
      rest('long');
      assert.equal(resourceState(db, 1).spent[0], 0);
      assert.deepEqual(resourceState(db, 1).arcanum, {});
    } finally { db.close(); }
  }
});

test('Human Resourceful grants Heroic Inspiration and restores it on a long rest', () => {
  const { db, rest } = setup();
  try {
    db.prepare('UPDATE characters SET species = ? WHERE id = 1').run('Człowiek (Human)');
    const state = resourceState(db, 1);
    state.heroicInspirationAvailable = false;
    saveResources(db, 1, state);
    assert.equal(speciesResourceState(db, 1).heroicInspirationAvailable, false);
    assert.equal(rest('long').status, 200);
    assert.equal(speciesResourceState(db, 1).heroicInspirationAvailable, true);
  } finally { db.close(); }
});

test('Goliath Giant Ancestry uses proficiency bonus and restores on a long rest', () => {
  const { db, rest } = setup();
  try {
    db.prepare('UPDATE characters SET species = ?, level = 5 WHERE id = 1').run('Goliat (Goliath)');
    const stats = JSON.parse(db.prepare('SELECT data FROM character_statistics WHERE character_id = 1').get().data);
    stats.traits = { giantAncestry: ['stone'] };
    db.prepare('UPDATE character_statistics SET data = ? WHERE character_id = 1').run(JSON.stringify(stats));
    const state = speciesResourceState(db, 1);
    assert.equal(state.goliathAncestry.id, 'stone');
    assert.equal(state.maxGiantAncestry, 3);
    assert.equal(state.giantAncestryUses, 3);
    const resources = resourceState(db, 1);
    resources.giantAncestryUses = 1;
    resources.largeFormAvailable = false;
    saveResources(db, 1, resources);
    assert.equal(rest('long').status, 200);
    const restored = speciesResourceState(db, 1);
    assert.equal(restored.giantAncestryUses, 3);
    assert.equal(restored.largeFormAvailable, true);
  } finally { db.close(); }
});

test('concentration persists as a character resource, damage prompts a CON save and zero HP ends it', () => {
  const { db, call, start, gm } = setup();
  try {
    const b = start().battle, self = b.fighters[0].id;
    assert.equal(call('act', { kind: 'cast', slot: 'action', spellId: 'faerie-fire', source: 'slot', level: 1 }).status, 200);
    call('act', { kind: 'resolve', note: 'Faerie Fire effects adjudicated' }, gm);
    assert.equal(resourceState(db, 1).concentration, 'Faerie Fire');
    call('act', { kind: 'resolve', note: 'Hit', targetId: self, effect: 'damage', amount: 2 }, gm);
    assert.equal(call().battle.fighters[0].concentrationDC, 10);
    assert.equal(call('next', {}, gm).status, 409);
    assert.equal(call('act', { kind: 'concentration', actorId: self, roll: 1 }).status, 200);
    assert.equal(resourceState(db, 1).concentration, null);
    call('end', {}, gm); const nextBattle = start().battle;
    call('act', { kind: 'cast', slot: 'action', spellId: 'faerie-fire', source: 'slot', level: 1 });
    call('act', { kind: 'resolve', note: 'Effect confirmed' }, gm);
    const lethal = call('act', { kind: 'resolve', note: 'Lethal hit', targetId: nextBattle.fighters[0].id, effect: 'damage', amount: 20 }, gm);
    assert.equal(lethal.status, 200);
    assert.equal(resourceState(db, 1).concentration, null);
  } finally { db.close(); }
});

test('Shield can interrupt a hit after deferring reaction; it consumes one slot and expires at the next own turn', () => {
  const { db, call, start, gm } = setup('wizard');
  try {
    const b = start().battle, self = b.fighters[0].id;
    assert.equal(call('act', { kind: 'skip', slot: 'reaction' }).status, 200);
    assert.equal(call().battle.fighters[0].reaction, '');
    call('next', {}, gm);
    const hit = call('act', { kind: 'attack', slot: 'action', targetId: self, roll: 10, attack: { id: 'attack', name: 'Claw', bonus: 4, dice: 1, sides: 6, damageBonus: 2 } }, gm);
    assert.equal(hit.battle.pending.kind, 'damage');
    const shield = call('act', { kind: 'cast', actorId: self, slot: 'reaction', spellId: 'shield', level: 1, source: 'slot' });
    assert.equal(shield.status, 200);
    assert.equal(shield.battle.fighters[0].ac, 16);
    assert.equal(shield.battle.pending, null);
    assert.equal(resourceState(db, 1).spent[0], 1);
    call('next', {}, gm); call('next', {}, gm);
    assert.equal(call().battle.fighters[0].ac, 11);
    assert.equal(call().battle.fighters[0].reaction, '');
  } finally { db.close(); }
});

test('multiple damage sources require separate concentration saves and Vicious Mockery forces only the next attack disadvantage', () => {
  const { db, call, start, gm } = setup();
  try {
    const b = start().battle, self = b.fighters[0].id, enemy = b.fighters[1].id;
    call('act', { kind: 'cast', slot: 'action', spellId: 'faerie-fire', source: 'slot', level: 1 });
    call('act', { kind: 'resolve', note: 'Effect confirmed' }, gm);
    for (let i = 0; i < 2; i++) call('act', { kind: 'resolve', note: 'Damage source', targetId: self, effect: 'damage', amount: 1 }, gm);
    assert.equal(call().battle.fighters[0].concentrationChecks.length, 2);
    call('act', { kind: 'concentration', actorId: self, roll: 20 });
    assert.equal(call().battle.fighters[0].concentrationDC, 10);
    call('act', { kind: 'concentration', actorId: self, roll: 20 });
    assert.equal(call().battle.fighters[0].concentrationDC, null);
    call('end', {}, gm); const next = start().battle;
    const nextEnemy = next.fighters[1].id;
    call('act', { kind: 'cast', slot: 'action', spellId: 'vicious-mockery', source: 'cantrip', level: 0, targetIds: [nextEnemy] });
    call('act', { kind: 'spell-save', targetId: nextEnemy, roll: 1 }, gm);
    call('act', { kind: 'spell-defense', targetId: nextEnemy, multiplier: 1 }, gm);
    call('act', { kind: 'spell-effect', rolls: [1] });
    call('next', {}, gm);
    const attack = { id: 'claw', name: 'Claw', bonus: 4, dice: 1, sides: 6, damageBonus: 2 };
    assert.equal(call('act', { kind: 'attack', slot: 'action', targetId: next.fighters[0].id, roll: 20, attack }, gm).status, 409);
    const roll = call('act', { kind: 'attack', slot: 'action', targetId: next.fighters[0].id, roll: 20, roll2: 1, attack }, gm);
    assert.equal(roll.battle.pending, null);
    assert.equal(roll.battle.fighters[1].mockery, null);
  } finally { db.close(); }
});
