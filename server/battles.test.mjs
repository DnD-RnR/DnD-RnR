import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from './db.mjs';
import { emptyStatistics } from './statistics.mjs';
import { handleBattles } from './battles.mjs';
import { handleStatistics } from './statistics.mjs';
import { handleGames } from './games.mjs';
import { exportRows, hydrate } from './firestore.mjs';
import { resourceState, saveResources, handleSpellResources, publicCaster } from './spell-resources.mjs';
import { rageProfile } from '../shared/barbarian.mjs';

function barbarianFixture(level = 1) {
  const f = fixture();
  f.db.prepare('UPDATE characters SET class = ?, level = ? WHERE id = 1').run('Barbarzyńca (Barbarian)', level);
  return f;
}

test('Danger Sense is level gated, works without Rage, cancels disadvantage and switches off during incapacitation', () => {
  for (const level of [1, 2]) {
    const { db, call, start, player } = barbarianFixture(level);
    try {
      const id = start().battle.fighters[0].id;
      assert.equal(call('act', { kind: 'saving-throw', ability: 'dex', roll: 7 }, player).status, level === 1 ? 200 : 409);
      if (level === 1) continue;
      const saved = call('act', { kind: 'saving-throw', ability: 'dex', roll: 2, roll2: 18 }, player);
      assert.match(saved.battle.log.at(-1), /19\./);
      assert.equal(call('act', { kind: 'saving-throw', ability: 'dex', roll: 7, disadvantage: true }, player).status, 200);
      call('act', { kind: 'condition', actorId: id, condition: 'incapacitated', enabled: true });
      const disabled = call('act', { kind: 'saving-throw', ability: 'dex', roll: 7 }, player);
      assert.equal(disabled.status, 200); assert.match(disabled.battle.log.at(-1), /8\./);
      call('act', { kind: 'condition', actorId: id, condition: 'incapacitated', enabled: false });
      assert.equal(call('act', { kind: 'saving-throw', ability: 'dex', roll: 7 }, player).status, 409);
    } finally { db.close(); }
  }
});

test('Reckless Attack grants Strength advantage and exposes the barbarian until the start of their next turn', () => {
  const { db, call, start, player } = barbarianFixture(5);
  try {
    const b = start().battle, id = b.fighters[0].id, targetId = b.fighters[1].id;
    assert.equal(call('act', { kind: 'attack', slot: 'action', attackId: '1', targetId, reckless: true, roll: 1 }, player).status, 409);
    assert.equal(call().battle.fighters[0].attackRollMade, false);
    const r = call('act', { kind: 'attack', slot: 'action', attackId: '1', targetId, reckless: true, roll: 1, roll2: 19 }, player);
    assert.equal(r.status, 200); assert.equal(r.battle.pending.kind, 'damage'); assert.equal(r.battle.fighters[0].recklessActive, true);
    assert.equal(r.battle.fighters[0].rage, undefined);
    call('act', { kind: 'damage', rolls: [1] }, player);
    assert.equal(call('act', { kind: 'attack', slot: 'action', attackId: 'unarmed', targetId, roll: 5 }, player).status, 409);
    assert.equal(call('act', { kind: 'attack', slot: 'action', attackId: 'unarmed', targetId, roll: 1, disadvantage: true }, player).status, 200);
    call('next', {}, player);
    const attack = { name: 'Club', bonus: 5, dice: 1, sides: 8, damageBonus: 4 };
    assert.equal(call('act', { kind: 'attack', slot: 'action', targetId: id, roll: 1, attack }).status, 409);
    const enemy = call('act', { kind: 'attack', slot: 'action', targetId: id, roll: 1, roll2: 19, attack });
    assert.equal(enemy.battle.pending.kind, 'damage');
    call('act', { kind: 'damage', rolls: [1] });
    call('next');
    assert.equal(call().battle.fighters[0].recklessActive, true);
    const next = call('next'); assert.equal(next.battle.fighters[0].recklessActive, false); assert.equal(next.battle.fighters[0].attackRollMade, false);
  } finally { db.close(); }
});

test('Reckless Attack cannot be chosen after the first roll or below level two', () => {
  for (const level of [1, 5]) {
    const { db, call, start, player } = barbarianFixture(level);
    try {
      const targetId = start().battle.fighters[1].id;
      const attack = { kind: 'attack', slot: 'action', attackId: '1', targetId, roll: 1 };
      if (level === 1) assert.equal(call('act', { ...attack, reckless: true, roll2: 2 }, player).status, 409);
      else {
        assert.equal(call('act', attack, player).status, 200);
        assert.equal(call('act', { ...attack, reckless: true, roll2: 2 }, player).status, 409);
        assert.equal(call().battle.fighters[0].recklessActive, false);
      }
    } finally { db.close(); }
  }
});

test('Reckless Attack may be declared on a Dexterity attack but only Strength attacks gain its advantage', () => {
  const { db, call, start, player } = barbarianFixture(5);
  try {
    db.exec("UPDATE character_items SET weapon_id = 'rapier' WHERE id = 1");
    const stats = JSON.parse(db.prepare('SELECT data FROM character_statistics WHERE character_id = 1').get().data);
    stats.values.dex = 18;
    db.prepare('UPDATE character_statistics SET data = ? WHERE character_id = 1').run(JSON.stringify(stats));
    const targetId = start().battle.fighters[1].id;
    assert.equal(call('act', { kind: 'attack', slot: 'action', attackId: '1', targetId, reckless: true, roll: 1 }, player).status, 200);
    assert.equal(call('act', { kind: 'attack', slot: 'action', attackId: '1', ability: 'str', targetId, roll: 1 }, player).status, 409);
    assert.equal(call('act', { kind: 'attack', slot: 'action', attackId: '1', ability: 'str', targetId, roll: 1, roll2: 2 }, player).status, 200);
  } finally { db.close(); }
});

test('Primal Knowledge uses its extra skill proficiency even without the original ability score', () => {
  const { db, call, start, player } = barbarianFixture(3);
  try {
    const stats = JSON.parse(db.prepare('SELECT data FROM character_statistics WHERE character_id = 1').get().data);
    stats.values.wis = null; stats.traits = { primalSkill: ['perception'] };
    db.prepare('UPDATE character_statistics SET data = ? WHERE character_id = 1').run(JSON.stringify(stats));
    start(); call('act', { kind: 'rage' }, player);
    const r = call('act', { kind: 'ability-check', skill: 'perception', primal: true, roll: 5, roll2: 15 }, player);
    assert.equal(r.status, 200); assert.match(r.battle.log.at(-1), /20\./);
  } finally { db.close(); }
});

test('finesse Strength selection, off-hand and unarmed strikes receive Rage damage but Dexterity does not', () => {
  const { db, call, start, player } = barbarianFixture(5);
  try {
    db.exec("UPDATE character_items SET weapon_id = 'scimitar' WHERE id = 1; INSERT INTO character_items (id,character_id,name,quantity,slot,equipped,weapon_id) VALUES (3,1,'Dagger',1,'off-hand',1,'dagger')");
    const stats = JSON.parse(db.prepare('SELECT data FROM character_statistics WHERE character_id = 1').get().data);
    stats.values.dex = 18;
    stats.choices.weaponMastery = ['dagger'];
    db.prepare('UPDATE character_statistics SET data = ? WHERE character_id = 1').run(JSON.stringify(stats));
    const b = start().battle, targetId = b.fighters[1].id;
    call('act', { kind: 'rage' }, player);
    let r = call('act', { kind: 'attack', slot: 'action', attackId: '1', targetId, roll: 20 }, player);
    assert.equal(r.battle.pending.attack.damageBonus, 4);
    call('act', { kind: 'damage', rolls: [1,1] }, player);
    r = call('act', { kind: 'attack', slot: 'action', attackId: '3', ability: 'str', targetId, roll: 20 }, player);
    assert.equal(r.battle.pending.attack.damageBonus, 2);
    call('act', { kind: 'damage', rolls: [1,1] }, player);
    r = call('act', { kind: 'attack', slot: 'action', attackId: 'unarmed', targetId, roll: 20 }, player);
    assert.equal(r.battle.pending.attack.damageBonus, 6);
  } finally { db.close(); }
});

test('typed monster attacks automatically apply Rage resistance and Incapacitated ends basic Rage', () => {
  const { db, call, start, player } = barbarianFixture();
  try {
    const id = start().battle.fighters[0].id;
    call('act', { kind: 'rage' }, player); call('next', {}, player);
    const attack = { name: 'Club', bonus: 5, dice: 1, sides: 8, damageBonus: 4, type: 'obuchowe' };
    assert.equal(call('act', { kind: 'attack', slot: 'action', targetId: id, roll: 15, attack }).status, 200);
    assert.equal(call('act', { kind: 'damage', rolls: [7] }).battle.fighters[0].hp, 28);
    assert.equal(call('act', { kind: 'condition', actorId: id, condition: 'incapacitated', enabled: true }, player).status, 409);
    assert.equal(call('act', { kind: 'condition', actorId: id, condition: 'incapacitated', enabled: true }).battle.fighters[0].rage, null);
  } finally { db.close(); }
});

test('Persistent Rage needs no extensions but expires after 100 rounds, and its initiative recovery does not reset next battle', () => {
  const { db, call, start, player } = barbarianFixture(15);
  try {
    const id = start().battle.fighters[0].id;
    call('act', { kind: 'rage-recover', actorId: id }, player);
    call('act', { kind: 'rage', feet: 15 }, player);
    assert.equal(call().battle.fighters[0].pounceMoved, 15);
    for (let round = 1; round <= 100; round++) {
      assert.ok(call().battle.fighters[0].rage);
      call('next', {}, player); call('next'); call('next');
    }
    assert.equal(call().battle.fighters[0].rage, null);
    call('end');
    const next = start();
    assert.equal(next.battle.fighters[0].rageUses, 4);
    assert.equal(next.battle.fighters[0].rageRecoveryOffered, false);
  } finally { db.close(); }
});

test('GM-confirmed enemy saving throw extends Rage and invalid Pounce activation rolls back resource consumption', () => {
  const { db, call, start, player } = barbarianFixture(7);
  try {
    const b = start().battle;
    assert.equal(call('act', { kind: 'rage', feet: 16 }, player).status, 409);
    assert.equal(publicCaster(db, 1).barbarian.uses, 4);
    call('act', { kind: 'rage', feet: 15 }, player);
    call('next', {}, player); call('next'); call('next');
    assert.equal(call('act', { kind: 'rage-force-save', actorId: b.fighters[0].id, targetId: b.fighters[2].id }).status, 409);
    const r = call('act', { kind: 'rage-force-save', actorId: b.fighters[0].id, targetId: b.fighters[1].id });
    assert.equal(r.status, 200); assert.equal(r.battle.fighters[0].rage.expiresRound, 3);
  } finally { db.close(); }
});

test('Rage scales at class level thresholds and is absent for other classes', () => {
  for (const [level, max, damage] of [[1,2,2],[3,3,2],[6,4,2],[9,4,3],[12,5,3],[16,5,4],[17,6,4],[20,6,4]]) {
    assert.deepEqual([rageProfile({ class: 'Barbarzyńca (Barbarian)', level }).max, rageProfile({ class: 'Barbarian', level }).damage], [max, damage]);
  }
  assert.equal(rageProfile({ class: 'Fighter', level: 20 }).max, 0);
});

test('Rage consumes the bonus action, breaks concentration, persists uses and adds damage once on a critical', () => {
  const { db, call, start, player } = barbarianFixture(9);
  try {
    const state = resourceState(db, 1); state.concentration = 'Light'; saveResources(db, 1, state);
    const b = start().battle;
    const r = call('act', { kind: 'rage' }, player); assert.equal(r.status, 200);
    assert.equal(r.battle.fighters[0].rageUses, 3); assert.equal(r.battle.fighters[0].concentration, null);
    assert.equal(resourceState(db, 1).concentration, null);
    assert.equal(call('act', { kind: 'rage' }, player).status, 409);
    assert.equal(resourceState(db, 1).rageUses, 3);
    assert.equal(call('act', { kind: 'cast', actorId: b.fighters[0].id, slot: 'action' }, player).status, 409);
    const hit = call('act', { kind: 'attack', slot: 'action', attackId: '1', targetId: b.fighters[1].id, roll: 20 }, player);
    assert.equal(hit.battle.pending.attack.damageBonus, 6);
    assert.equal(call('act', { kind: 'damage', rolls: [4,4] }, player).status, 200);
    assert.equal(call().battle.fighters[1].hp, 66);
    assert.equal(publicCaster(db, 1).barbarian.uses, 3);
  } finally { db.close(); }
});

test('Rage resistance halves physical damage once and does not affect fire', () => {
  const { db, call, start, player } = barbarianFixture();
  try {
    const id = start().battle.fighters[0].id;
    call('act', { kind: 'rage' }, player);
    let r = call('act', { kind: 'resolve', note: 'hit', targetId: id, effect: 'damage', amount: 11, damageType: 'cięte' });
    assert.equal(r.battle.fighters[0].hp, 28);
    r = call('act', { kind: 'resolve', note: 'fire', targetId: id, effect: 'damage', amount: 7, damageType: 'ogień' });
    assert.equal(r.battle.fighters[0].hp, 21);
  } finally { db.close(); }
});

test('Rage expires at the end of the next turn; a missed attack and bonus action extend it', () => {
  const { db, call, start, player } = barbarianFixture();
  try {
    const b = start().battle;
    call('act', { kind: 'rage' }, player);
    call('next', {}, player); call('next'); call('next');
    assert.equal(call().battle.round, 2);
    let r = call('act', { kind: 'attack', slot: 'action', attackId: '1', targetId: b.fighters[1].id, roll: 1 }, player);
    assert.equal(r.battle.fighters[0].rage.expiresRound, 3);
    call('next', {}, player); call('next'); call('next');
    r = call('act', { kind: 'rage-extend' }, player); assert.equal(r.battle.fighters[0].rage.expiresRound, 4);
    call('next', {}, player); call('next'); call('next');
    assert.equal(call('next', {}, player).battle.fighters[0].rage, null);
  } finally { db.close(); }
});

test('heavy armor blocks Rage and equipping it ends an active Rage', () => {
  const { db, call, start, player } = barbarianFixture();
  try {
    db.exec("INSERT INTO character_items (id,character_id,name,quantity,slot,equipped,armor_id) VALUES (3,1,'Plate',1,'body',1,'plate')");
    start(); assert.equal(call('act', { kind: 'rage' }, player).status, 409);
    db.exec('UPDATE character_items SET equipped = 0 WHERE id = 3');
    assert.equal(call('act', { kind: 'rage' }, player).status, 200);
    db.exec('UPDATE character_items SET equipped = 1 WHERE id = 3');
    assert.equal(call('act', { kind: 'move', feet: 1 }, player).battle.fighters[0].rage, null);
  } finally { db.close(); }
});

test('Primal Knowledge uses Strength and proficiency and Rage forces advantage on Strength saves', () => {
  const { db, call, start, player } = barbarianFixture(3);
  try {
    const stats = JSON.parse(db.prepare('SELECT data FROM character_statistics WHERE character_id = 1').get().data);
    stats.skills.perception = 2;
    db.prepare('UPDATE character_statistics SET data = ? WHERE character_id = 1').run(JSON.stringify(stats));
    start(); call('act', { kind: 'rage' }, player);
    assert.equal(call('act', { kind: 'ability-check', skill: 'perception', primal: true, roll: 4 }, player).status, 409);
    const r = call('act', { kind: 'ability-check', skill: 'perception', primal: true, roll: 4, roll2: 15 }, player);
    assert.equal(r.status, 200); assert.match(r.battle.log.at(-1), /22\./);
    assert.equal(call('act', { kind: 'saving-throw', ability: 'str', roll: 10 }, player).status, 409);
    assert.equal(call('act', { kind: 'saving-throw', ability: 'str', roll: 10, disadvantage: true }, player).status, 200);
    assert.equal(call('act', { kind: 'ability-check', skill: 'arcana', primal: true, roll: 10, roll2: 15 }, player).status, 409);
  } finally { db.close(); }
});

test('Relentless Rage gates progress, restores twice class level and increases DC; instant death bypasses it', () => {
  for (const instant of [false, true]) {
    const { db, call, start, player } = barbarianFixture(11);
    try {
      const id = start().battle.fighters[0].id; call('act', { kind: 'rage' }, player);
      const r = call('act', { kind: 'resolve', note: 'hit', targetId: id, effect: 'damage', amount: instant ? 100 : 34, damageType: 'ogień' });
      if (instant) { assert.equal(r.battle.fighters[0].deathFailures, 3); assert.equal(r.battle.fighters[0].rage, null); continue; }
      assert.equal(r.battle.fighters[0].relentlessRagePending.dc, 10);
      assert.equal(call('next').status, 409);
      const saved = call('act', { kind: 'relentless-rage', actorId: id, roll: 10 }, player);
      assert.equal(saved.status, 200); assert.equal(saved.battle.fighters[0].hp, 22); assert.ok(saved.battle.fighters[0].rage);
      assert.equal(resourceState(db, 1).relentlessRageDC, 15);
      assert.equal(call('act', { kind: 'resolve', note: 'hit', targetId: id, effect: 'damage', amount: 22 }).battle.fighters[0].relentlessRagePending.dc, 15);
      assert.equal(call('act', { kind: 'relentless-rage', actorId: id, roll: 1 }, player).battle.fighters[0].rage, null);
    } finally { db.close(); }
  }
});

test('Persistent Rage recovers on initiative once per long rest, survives incapacitation and ends on unconsciousness', () => {
  const { db, call, start, player } = barbarianFixture(15);
  try {
    const state = resourceState(db, 1); state.rageUses = 0; saveResources(db, 1, state);
    const id = start().battle.fighters[0].id;
    assert.equal(call('act', { kind: 'rage-recover', actorId: id }, player).battle.fighters[0].rageUses, 5);
    assert.equal(call('act', { kind: 'rage-recover', actorId: id }, player).status, 409);
    call('act', { kind: 'rage' }, player);
    assert.ok(call('act', { kind: 'condition', actorId: id, condition: 'incapacitated', enabled: true }).battle.fighters[0].rage);
    assert.equal(call('act', { kind: 'move', feet: 1 }, player).status, 409);
    assert.equal(call('act', { kind: 'condition', actorId: id, condition: 'unconscious', enabled: true }).battle.fighters[0].rage, null);
  } finally { db.close(); }
});

test('short and long rests restore Rage resources and reset Relentless Rage DC', () => {
  const { db, gm } = barbarianFixture(15);
  try {
    const state = resourceState(db, 1); state.rageUses = 1; state.relentlessRageDC = 20; state.persistentRageAvailable = false; saveResources(db, 1, state);
    const rest = type => handleSpellResources(db, gm, '/api/games/1/spell-rest', 'POST', { rest: type }, status => assert.equal(status, 200));
    rest('short'); assert.equal(resourceState(db, 1).rageUses, 2); assert.equal(resourceState(db, 1).relentlessRageDC, 10); assert.equal(resourceState(db, 1).persistentRageAvailable, false);
    rest('long'); assert.equal(resourceState(db, 1).rageUses, 5); assert.equal(resourceState(db, 1).persistentRageAvailable, true);
  } finally { db.close(); }
});

function druidFixture(level = 2) {
  const f = fixture();
  f.db.prepare('UPDATE characters SET class = ?, level = ? WHERE id = 1').run('Druid', level);
  const stats = JSON.parse(f.db.prepare('SELECT data FROM character_statistics WHERE character_id = 1').get().data);
  stats.traits.druidForms = ['rat', 'riding-horse', 'spider', 'wolf'];
  stats.spells = { choices: { order: 'martial' }, selections: { cantrips: ['druidcraft', 'produce-flame'], prepared: ['cure-wounds', 'faerie-fire', 'thunderwave', 'entangle', 'healing-word'].slice(0, level + 3) } };
  f.db.prepare('UPDATE character_statistics SET data = ? WHERE character_id = 1').run(JSON.stringify(stats));
  return f;
}

test('Druid Wild Shape enforces level, ownership, known forms, bonus actions and blocks casting', () => {
  for (const level of [1, 2]) {
    const { db, call, start, player, other } = druidFixture(level);
    try {
      const initial = start().battle.fighters[0];
      const body = { kind: 'wild-shape', formId: 'wolf', equipment: 'merge', actorId: initial.id };
      assert.equal(call('act', body, other).status, 409);
      assert.equal(call('act', { ...body, formId: 'cat' }, player).status, 409);
      const result = call('act', body, player);
      assert.equal(result.status, level === 2 ? 200 : 409);
      if (level === 1) continue;
      const f = result.battle.fighters[0];
      assert.equal(f.ac, 12); assert.equal(f.hp, initial.hp); assert.equal(f.tempHp, 3); assert.equal(f.wildShapeUses, 1);
      assert.equal(resourceState(db, 1).wildShapeUses, 1);
      assert.equal(call('act', { kind: 'wild-shape-end' }, player).status, 409);
      assert.equal(call('act', { kind: 'cast', spellId: 'druidcraft', level: 0, slot: 'action' }, player).status, 409);
      assert.equal(call('act', { kind: 'condition', actorId: f.id, condition: 'incapacitated', enabled: true }).status, 200);
      assert.equal(call().battle.fighters[0].wildShape, null);
      assert.equal(call().battle.fighters[0].ac, initial.ac);
    } finally { db.close(); }
  }
});

test('Druid form persists across battles, expires, and short rest restores only one use', () => {
  const { db, call, start, player, gm } = druidFixture();
  try {
    start();
    assert.equal(call('act', { kind: 'wild-shape', formId: 'wolf', equipment: 'merge' }, player).status, 200);
    call('end');
    assert.equal(start().battle.fighters[0].wildShape.formId, 'wolf');
    const state = resourceState(db, 1); state.wildShape.expiresAt = 1; state.wildShapeUses = 0; saveResources(db, 1, state);
    call('end');
    assert.equal(start().battle.fighters[0].wildShape ?? null, null);
    call('end');
    handleSpellResources(db, gm, '/api/games/1/spell-rest', 'POST', { rest: 'short' }, status => assert.equal(status, 200));
    assert.equal(resourceState(db, 1).wildShapeUses, 1);
  } finally { db.close(); }
});

test('Wild Companion spends a shared Wild Shape use or spell slot and expires on long rest', () => {
  for (const source of ['wild-shape', 'slot']) {
    const { db, call, start, player, gm } = druidFixture();
    try {
      start();
      const summoned = call('act', { kind: 'wild-companion', source, level: 1, form: 'owl' }, player);
      assert.equal(summoned.status, 200, summoned.error);
      const state = resourceState(db, 1);
      assert.equal(state.wildCompanion.creatureType, 'fey');
      assert.equal(source === 'slot' ? state.spent[0] : state.wildShapeUses, 1);
      assert.equal(call('act', { kind: 'wild-companion', source, level: 1, form: 'rat' }, player).status, 409);
      call('end');
      handleSpellResources(db, gm, '/api/games/1/spell-rest', 'POST', { rest: 'short' }, status => assert.equal(status, 200));
      assert.equal(resourceState(db, 1).wildShapeUses, 2);
      assert.ok(resourceState(db, 1).wildCompanion);
      handleSpellResources(db, gm, '/api/games/1/spell-rest', 'POST', { rest: 'long' }, status => assert.equal(status, 200));
      assert.equal(resourceState(db, 1).wildCompanion, null);
      assert.equal(resourceState(db, 1).spent[0], 0);
    } finally { db.close(); }
  }
});

function fixture() {
  const db = openDatabase(':memory:');
  db.exec(`INSERT INTO users VALUES (1,'gm','GM','unused','gm'), (2,'hero','Hero','unused','player'), (3,'other','Other','unused','player'), (4,'gm2','GM2','unused','gm');
    INSERT INTO games (id,gm_id,name) VALUES (1,1,'Game'), (2,4,'Other game');
    INSERT INTO game_sessions (id,game_id,started_at) VALUES (1,1,1);
    INSERT INTO characters (id,user_id,name,class,level) VALUES (1,2,'Hero','Fighter',5),(2,3,'Other','Bard',1);
    INSERT INTO game_members (id,game_id,character_id,status) VALUES (1,1,1,'accepted'), (2,1,2,'accepted');
    INSERT INTO session_participants VALUES (1,1,1),(1,2,1);
    INSERT INTO game_monster_entries VALUES (1,'ogre','Ogre',80,12,30,'', '{"str":2,"dex":0,"con":0,"int":0,"wis":0,"cha":0}');
    INSERT INTO character_items (id,character_id,name,quantity,slot,equipped,weapon_id) VALUES (1,1,'Sword',1,'main-hand',1,'longsword');`);
  const stats = emptyStatistics();
  db.prepare('UPDATE characters SET class = ? WHERE id = 1').run('Wojownik (Fighter)');
  Object.assign(stats.values, { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10, hp: 30, maxHp: 30, tempHp: 3, ac: 15, speed: 30 });
  for (const id of [1, 2]) db.prepare('INSERT INTO character_statistics VALUES (?, ?)').run(id, JSON.stringify(stats));
  const gm = { id: 1, role: 'gm' }, player = { id: 2, role: 'player' }, other = { id: 3, role: 'player' };
  let version = 0;
  const call = (action = '', body = {}, user = gm) => {
    let result;
    assert.equal(handleBattles(db, user, `/api/games/1/battle${action ? '/' + action : ''}`, action ? 'POST' : 'GET', { sessionId: 1, version, ...body }, (status, data) => { result = { status, ...data }; }), true);
    if (result.battle) version = result.battle.version;
    return result;
  };
  const start = () => call('start', { fighters: [{ memberId: 1, initiative: 20 }, { enemyId: 'ogre', initiative: 10 }, { memberId: 2, initiative: 5 }] });
  return { db, call, start, gm, player, other };
}

test('shared battle enforces ownership, initiative, versions and action economy', () => {
  const { db, call, start, player, other } = fixture();
  try {
    assert.equal(call().battle, null);
    assert.equal(call('start', { fighters: [] }, player).status, 409);
    const started = start(); assert.equal(started.status, 200);
    assert.equal(started.battle.fighters[0].name, 'Hero');
    assert.deepEqual(started.controlledIds, [started.battle.fighters[1].id]);
    assert.deepEqual(call('', {}, player).controlledIds, [started.battle.fighters[0].id]);
    assert.equal(call('act', { kind: 'dash' }).status, 409);
    assert.equal(call('act', { kind: 'dash' }, other).status, 409);
    assert.equal(call('act', { kind: 'dash', version: 0 }, player).status, 409);
    assert.equal(call('act', { kind: 'dash' }, player).battle.fighters[0].extraMove, 30);
    assert.equal(call('act', { kind: 'dodge' }, player).status, 409);
    assert.equal(call('act', { kind: 'move', feet: 50 }, player).status, 200);
    assert.equal(call('act', { kind: 'move', feet: 11 }, player).status, 409);
    assert.equal(call('next', {}, other).status, 409);
    assert.equal(call('next', {}, player).battle.turn, 1);
    assert.equal(call('act', { kind: 'dodge' }, player).status, 409);
    assert.equal(call('end', {}, player).status, 409);
    const saved = hydrate(exportRows(db));
    try { assert.equal(JSON.parse(saved.prepare('SELECT data FROM session_battles').get().data).turn, 1); }
    finally { saved.close(); }
    call('next');
    const round = call('next'); assert.equal(round.battle.round, 2); assert.equal(round.battle.fighters[0].action, '');
  } finally { db.close(); }
});

test('GM can discover and reopen the same persisted battle after navigating away', () => {
  const { db, call, start, gm } = fixture();
  let restored;
  const gameView = (connection, path) => {
    let result;
    handleGames(connection, gm, path, 'GET', {}, (status, data) => { assert.equal(status, 200); result = data; });
    return result;
  };
  try {
    assert.equal(gameView(db, '/api/games').games.find(g => g.id === 1).activeBattleSessionId, null);
    start(); call('next');
    const expected = call().battle;
    restored = hydrate(exportRows(db));
    assert.equal(gameView(restored, '/api/games').games.find(g => g.id === 1).activeBattleSessionId, 1);
    assert.equal(gameView(restored, '/api/games/1').activeBattle.sessionId, 1);
    handleBattles(restored, gm, '/api/games/1/battle', 'GET', {}, (status, data) => {
      assert.equal(status, 200); assert.deepEqual(data.battle, expected);
    });
    call('end');
    assert.equal(gameView(db, '/api/games/1').activeBattle, null);
  } finally { restored?.close(); db.close(); }
});

test('GM ending a cleared or unfinished battle persists a shared summary without revealing monster stats', () => {
  const { db, call, start, player } = fixture();
  let restored;
  try {
    const b = start().battle;
    call('act', { kind: 'resolve', note: 'Lethal effect', effect: 'damage', targetId: b.fighters[1].id, amount: 100 });
    const cleared = call().battle;
    assert.equal(cleared.active, true); // Ending remains the GM's decision.
    assert.equal(cleared.fighters.filter(f => !f.characterId).length, 0);
    assert.equal(call('end', {}, player).status, 409);
    const ended = call('end').battle;
    assert.equal(ended.active, false);
    assert.equal(ended.summary.defeatedMonsterCount, 1);
    assert.equal(ended.summary.remainingMonsterCount, 0);
    assert.equal(ended.summary.rounds, cleared.round);
    assert.ok(ended.summary.endedAt > 0);
    assert.deepEqual(call('', {}, player).battle.summary, ended.summary);
    assert.deepEqual(Object.keys(call('', {}, player).battle.defeatedMonsters[0]).sort(), ['damageTaken', 'id', 'name']);
    restored = hydrate(exportRows(db));
    assert.deepEqual(JSON.parse(restored.prepare('SELECT data FROM session_battles').get().data).summary, ended.summary);
    start();
    const manual = call('end').battle;
    assert.equal(manual.summary.remainingMonsterCount, 1);
    assert.equal(manual.summary.defeatedMonsterCount, 0);
    assert.equal(manual.pending, null);
  } finally { restored?.close(); db.close(); }
});

test('attacks use server weapon bonuses, critical dice and do not apply damage twice', () => {
  const { db, call, start, player } = fixture();
  try {
    const started = start(); const target = started.battle.fighters[1].id;
    assert.equal(started.battle.fighters[0].attacks.find(a => a.id === '1').bonus, 6);
    const hit = call('act', { kind: 'attack', slot: 'action', attackId: '1', targetId: target, roll: 20, attack: { bonus: 999 } }, player);
    assert.equal(hit.battle.pending.critical, true);
    assert.equal(call('act', { kind: 'damage', rolls: [8, 7] }).status, 409);
    assert.equal(call('next', {}, player).status, 409);
    assert.equal(call('act', { kind: 'damage', rolls: [9, 8] }, player).status, 409);
    const dealt = call('act', { kind: 'damage', rolls: [8, 7] }, player);
    assert.equal(dealt.battle.fighters[1].damageTaken, 18); // 8+7+3, not twice the modifier.
    assert.equal(call().battle.fighters[1].hp, 62);
    assert.equal(call('act', { kind: 'damage', rolls: [8, 7] }, player).status, 409);
    const miss = call('act', { kind: 'attack', slot: 'action', attackId: '1', targetId: target, roll: 1 }, player);
    assert.equal(miss.battle.pending, null);
    assert.equal(call('act', { kind: 'attack', slot: 'action', attackId: '1', targetId: target, roll: 20 }, player).status, 409);
  } finally { db.close(); }
});

test('Tavern Brawler changes the server unarmed strike to 1d4 plus Strength', () => {
  const { db, start } = fixture();
  try {
    db.prepare('UPDATE characters SET background = ? WHERE id = 1').run('Żeglarz (Sailor)');
    const started = start();
    const unarmed = started.battle.fighters[0].attacks.find(attack => attack.id === 'unarmed');
    assert.deepEqual({ dice: unarmed.dice, sides: unarmed.sides, damageBonus: unarmed.damageBonus }, { dice: 1, sides: 4, damageBonus: 3 });
  } finally { db.close(); }
});

test('Orc Adrenaline Rush uses a bonus action and Relentless Endurance prevents dropping to zero', () => {
  const { db, call, start, player } = fixture();
  try {
    db.prepare('UPDATE characters SET species = ? WHERE id = 1').run('Ork (Orc)');
    const started = start();
    const hero = started.battle.fighters.find(f => f.characterId === 1);
    assert.equal(hero.adrenalineRushUses, 3);
    const rushed = call('act', { kind: 'adrenaline-rush', slot: 'bonus' }, player);
    const rushedHero = rushed.battle.fighters.find(f => f.characterId === 1);
    assert.equal(rushedHero.bonus, 'Adrenaline Rush');
    assert.equal(rushedHero.adrenalineRushUses, 2);
    assert.equal(rushedHero.extraMove, rushedHero.speed);
    assert.equal(rushedHero.tempHp, 3);
    const result = call('act', { kind: 'resolve', note: 'Relentless Endurance', targetId: rushedHero.id, effect: 'damage', amount: 34 });
    const survived = result.battle.fighters.find(f => f.characterId === 1);
    assert.equal(survived.hp, 1);
    assert.equal(survived.relentlessEnduranceAvailable, false);
  } finally { db.close(); }
});

test('Dragonborn breath weapon and draconic flight are server-controlled resources', () => {
  const { db, call, start, player } = fixture();
  try {
    db.prepare('UPDATE characters SET species = ?, level = 5 WHERE id = 1').run('Smokowiec (Dragonborn)');
    const stats = JSON.parse(db.prepare('SELECT data FROM character_statistics WHERE character_id = 1').get().data);
    stats.traits = { dragonbornAncestry: ['fire'] };
    db.prepare('UPDATE character_statistics SET data = ? WHERE character_id = 1').run(JSON.stringify(stats));
    const started = start();
    const hero = started.battle.fighters.find(f => f.characterId === 1);
    assert.equal(hero.breathWeaponUses, 3);
    assert.equal(hero.breathWeaponDamage, 2);
    assert.equal(hero.breathWeaponType, 'ogień');
    assert.equal(hero.draconicFlightAvailable, true);
    const breath = call('act', { kind: 'breath-weapon', slot: 'action' }, player);
    assert.equal(breath.battle.pending.breathWeapon, true);
    assert.equal(breath.battle.fighters.find(f => f.characterId === 1).breathWeaponUses, 2);
  } finally { db.close(); }
});

test('fighter second wind heals from a d10, consumes a use and bonus action', () => {
  const { db, call, start, player } = fixture();
  try {
    const started = start();
    const fighter = started.battle.fighters[0];
    call('act', { kind: 'resolve', note: 'Damage', targetId: fighter.id, effect: 'damage', amount: 10 });
    const healed = call('act', { kind: 'second-wind', slot: 'bonus', roll: 10 }, player);
    const actor = healed.battle.fighters[0];
    assert.equal(actor.hp, 30);
    assert.equal(actor.bonus, 'Drugi oddech');
    assert.equal(actor.secondWindUses, 2);
    assert.equal(call('act', { kind: 'second-wind', slot: 'bonus', roll: 10 }, player).status, 409);
    const resources = JSON.parse(db.prepare('SELECT data FROM character_spell_resources WHERE character_id = 1').get().data);
    assert.equal(resources.secondWindUses, 2);
  } finally { db.close(); }
});

test('Archery adds two to attacks with ranged weapons only', () => {
  const { db, start } = fixture();
  try {
    db.prepare(`INSERT INTO character_items (id, character_id, name, quantity, slot, equipped, weapon_id)
      VALUES (2, 1, 'Shortbow', 1, 'backpack', 1, 'shortbow')`).run();
    db.prepare(`UPDATE character_statistics
      SET data = json_set(data, '$.choices.fightingStyle', 'archery') WHERE character_id = 1`).run();
    const attacks = start().battle.fighters[0].attacks;
    assert.equal(attacks.find(attack => attack.id === '1').bonus, 6);
    assert.equal(attacks.find(attack => attack.id === '2').bonus, 6);
  } finally { db.close(); }
});

test('Dueling adds two damage with a single one-handed melee weapon', () => {
  const { db, start } = fixture();
  try {
    db.prepare(`UPDATE character_statistics
      SET data = json_set(data, '$.choices.fightingStyle', 'dueling') WHERE character_id = 1`).run();
    assert.equal(start().battle.fighters[0].attacks.find(attack => attack.id === '1').damageBonus, 5);
  } finally { db.close(); }
});

test('Dueling does not apply when another weapon is equipped or the weapon uses two hands', () => {
  const { db, start } = fixture();
  try {
    db.prepare(`INSERT INTO character_items (id, character_id, name, quantity, slot, equipped, weapon_id)
      VALUES (2, 1, 'Dagger', 1, 'off-hand', 1, 'dagger')`).run();
    db.prepare(`UPDATE character_statistics
      SET data = json_set(data, '$.choices.fightingStyle', 'dueling') WHERE character_id = 1`).run();
    assert.equal(start().battle.fighters[0].attacks.find(attack => attack.id === '1').damageBonus, 3);
  } finally { db.close(); }

  const twoHanded = fixture();
  try {
    twoHanded.db.prepare(`UPDATE character_items SET weapon_id = 'greatsword' WHERE id = 1`).run();
    twoHanded.db.prepare(`UPDATE character_statistics
      SET data = json_set(data, '$.choices.fightingStyle', 'dueling') WHERE character_id = 1`).run();
    assert.equal(twoHanded.start().battle.fighters[0].attacks.find(attack => attack.id === '1').damageBonus, 3);
  } finally { twoHanded.db.close(); }
});

test('Two-Weapon Fighting adds the ability modifier to the off-hand light weapon', () => {
  const { db, start } = fixture();
  try {
    db.prepare(`INSERT INTO character_items (id, character_id, name, quantity, slot, equipped, weapon_id)
      VALUES (2, 1, 'Dagger', 1, 'off-hand', 1, 'dagger')`).run();
    db.prepare(`UPDATE character_statistics
      SET data = json_set(data, '$.choices.fightingStyle', 'two-weapon-fighting') WHERE character_id = 1`).run();
    const attacks = start().battle.fighters[0].attacks;
    assert.equal(attacks.find(attack => attack.id === '1').damageBonus, 3);
    assert.equal(attacks.find(attack => attack.id === '2').damageBonus, 3);
  } finally { db.close(); }
});

test('Thrown Weapon Fighting adds two damage to thrown weapons', () => {
  const { db, start } = fixture();
  try {
    db.prepare(`UPDATE character_items SET weapon_id = 'dagger' WHERE id = 1`).run();
    db.prepare(`UPDATE character_statistics
      SET data = json_set(data, '$.choices.fightingStyle', 'thrown-weapon-fighting') WHERE character_id = 1`).run();
    assert.equal(start().battle.fighters[0].attacks.find(attack => attack.id === '1').damageBonus, 5);
  } finally { db.close(); }
});

test('Unarmed Fighting changes unarmed strike damage dice based on held equipment', () => {
  const withWeapon = fixture();
  try {
    withWeapon.db.prepare(`UPDATE character_statistics
      SET data = json_set(data, '$.choices.fightingStyle', 'unarmed-fighting') WHERE character_id = 1`).run();
    const attack = withWeapon.start().battle.fighters[0].attacks.find(attack => attack.id === 'unarmed');
    assert.deepEqual({ dice: attack.dice, sides: attack.sides, damageBonus: attack.damageBonus }, { dice: 1, sides: 6, damageBonus: 3 });
  } finally { withWeapon.db.close(); }

  const emptyHands = fixture();
  try {
    emptyHands.db.prepare('UPDATE character_items SET equipped = 0 WHERE character_id = 1').run();
    emptyHands.db.prepare(`UPDATE character_statistics
      SET data = json_set(data, '$.choices.fightingStyle', 'unarmed-fighting') WHERE character_id = 1`).run();
    const attack = emptyHands.start().battle.fighters[0].attacks.find(attack => attack.id === 'unarmed');
    assert.deepEqual({ dice: attack.dice, sides: attack.sides, damageBonus: attack.damageBonus }, { dice: 1, sides: 8, damageBonus: 3 });
  } finally { emptyHands.db.close(); }

  const shield = fixture();
  try {
    shield.db.prepare('UPDATE character_items SET equipped = 0 WHERE character_id = 1').run();
    shield.db.prepare(`INSERT INTO character_items (id, character_id, name, quantity, slot, equipped, armor_id)
      VALUES (2, 1, 'Shield', 1, 'off-hand', 1, 'shield')`).run();
    shield.db.prepare(`UPDATE character_statistics
      SET data = json_set(data, '$.choices.fightingStyle', 'unarmed-fighting') WHERE character_id = 1`).run();
    const attack = shield.start().battle.fighters[0].attacks.find(attack => attack.id === 'unarmed');
    assert.deepEqual({ dice: attack.dice, sides: attack.sides, damageBonus: attack.damageBonus }, { dice: 1, sides: 6, damageBonus: 3 });
  } finally { shield.db.close(); }
});

test('Protection uses a reaction only while holding a shield and gives attacks disadvantage until the protector turns', () => {
  const { db, call, start, player } = fixture();
  try {
    db.prepare(`INSERT INTO character_items (id, character_id, name, quantity, slot, equipped, armor_id)
      VALUES (2, 1, 'Shield', 1, 'off-hand', 1, 'shield')`).run();
    db.prepare(`UPDATE character_statistics
      SET data = json_set(data, '$.choices.fightingStyle', 'protection') WHERE character_id = 1`).run();
    const battle = start().battle, protector = battle.fighters[0], target = battle.fighters[2], enemy = battle.fighters[1];
    assert.equal(protector.protectionAvailable, true);
    const protectedBattle = call('act', { kind: 'protection', actorId: protector.id, targetId: target.id }, player).battle;
    assert.deepEqual(protectedBattle.fighters.find(f => f.id === target.id).protectedBy, [protector.id]);
    assert.equal(protectedBattle.fighters.find(f => f.id === protector.id).reaction, 'Protection');
    call('next', {}, player);
    assert.equal(call().battle.fighters.find(f => f.id === target.id).attackDisadvantage, true);
    const attack = call('act', { kind: 'attack', slot: 'action', attackId: 'attack', targetId: target.id, roll: 20, roll2: 1, attack: { name: 'Claw', bonus: 4, dice: 1, sides: 6, damageBonus: 2 } });
    assert.equal(attack.status, 200);
    assert.equal(attack.battle.pending, null);
    call('next');
    call('next');
    const afterProtectorTurn = call().battle.fighters.find(f => f.id === target.id);
    assert.equal(afterProtectorTurn.attackDisadvantage, false);
  } finally { db.close(); }
});

test('turn steps can skip remaining Extra Attacks and persist skipped actions', () => {
  const { db, call, start, player } = fixture();
  try {
    const targetId = start().battle.fighters[1].id;
    call('act', { kind: 'attack', slot: 'action', attackId: '1', targetId, roll: 1 }, player);
    assert.equal(call().battle.fighters[0].attacksLeft, 1);
    assert.equal(call('act', { kind: 'skip', slot: 'action' }, player).battle.fighters[0].attacksLeft, 0);
    assert.equal(call('act', { kind: 'attack', slot: 'action', attackId: '1', targetId, roll: 20 }, player).status, 409);
    assert.equal(call('act', { kind: 'skip', slot: 'bonus' }, player).status, 200);
    assert.equal(call('act', { kind: 'skip', slot: 'reaction' }, player).status, 200);
    const fighter = JSON.parse(db.prepare('SELECT data FROM session_battles').get().data).fighters[0];
    assert.equal(fighter.action, 'Pominięto');
    assert.equal(fighter.bonus, 'Pominięto');
    assert.equal(fighter.reaction, '');
    assert.equal(fighter.reactionDeferred, true);
    assert.equal(call('next', {}, player).battle.turn, 1);
  } finally { db.close(); }
});

test('player responses hide monster armor class, including legacy combat logs', () => {
  const { db, call, start, player } = fixture();
  try {
    const started = start();
    assert.equal(started.battle.fighters[1].ac, 12);
    const playerView = call('', {}, player);
    assert.equal(playerView.battle.fighters[1].ac, undefined);
    assert.equal(playerView.battle.fighters[0].ac, 11);
    const stored = JSON.parse(db.prepare('SELECT data FROM session_battles').get().data);
    stored.log.push('Hero → Ogre: 15 + 6 vs KP 12: trafienie.');
    db.prepare('UPDATE session_battles SET data = ?').run(JSON.stringify(stored));
    assert.equal(call('', {}, player).battle.log.some(entry => entry.includes('KP')), false);
    const attack = call('act', { kind: 'attack', slot: 'action', attackId: '1', targetId: stored.fighters[1].id, roll: 15 }, player);
    assert.equal(attack.status, 200);
    assert.equal(attack.battle.pending.kind, 'damage');
    assert.equal(attack.battle.fighters[1].ac, undefined);
    assert.equal(attack.battle.log.some(entry => entry.includes('KP')), false);
    assert.equal(JSON.parse(db.prepare('SELECT data FROM session_battles').get().data).fighters[1].ac, 12);
  } finally { db.close(); }
});

test('players receive only monster identity and cumulative damage, never stat blocks or attack profiles', () => {
  const { db, call, start, player } = fixture();
  try {
    const initial = start().battle;
    const targetId = initial.fighters[1].id;
    const hidden = call('', {}, player).battle.fighters[1];
    assert.deepEqual(Object.keys(hidden).sort(), ['attackDisadvantage', 'damageTaken', 'hidden', 'id', 'name']);
    assert.equal(hidden.damageTaken, 0);
    call('act', { kind: 'resolve', note: 'Hit', targetId, effect: 'damage', amount: 10 });
    call('act', { kind: 'resolve', note: 'Heal', targetId, effect: 'heal', amount: 5 });
    assert.equal(call('', {}, player).battle.fighters[1].damageTaken, 10);
    assert.equal(call().battle.fighters[1].hp, 75);
    call('next');
    call('act', { kind: 'attack', slot: 'action', targetId: initial.fighters[0].id, roll: 20,
      attack: { id: 'club', name: 'Secret attack', bonus: 7, dice: 2, sides: 8, damageBonus: 5 } });
    const view = call('', {}, player).battle;
    assert.equal(view.pending.kind, 'waiting');
    assert.equal(view.pending.attack, undefined);
    assert.equal(view.log.at(-1).includes('20 + 7'), false);
    assert.equal(call().battle.pending.attack.bonus, 7);
  } finally { db.close(); }
});

test('dead monsters leave the battlefield once and do not shift or skip a surviving current turn', () => {
  const { db, call, start, player } = fixture();
  try {
    const b = start().battle, monster = b.fighters[1];
    call('act', { kind: 'attack', slot: 'action', attackId: '1', targetId: monster.id, roll: 20 }, player);
    // Lower only the test monster's remaining HP so the actual rolled attack is lethal.
    const saved = JSON.parse(db.prepare('SELECT data FROM session_battles').get().data);
    saved.fighters[1].hp = 1;
    db.prepare('UPDATE session_battles SET data = ?').run(JSON.stringify(saved));
    const result = call('act', { kind: 'damage', rolls: [1, 1] }, player);
    assert.equal(result.status, 200);
    assert.equal(result.battle.fighters.some(f => f.id === monster.id), false);
    assert.equal(result.battle.fighters[result.battle.turn].id, b.fighters[0].id);
    assert.equal(result.battle.log.filter(e => e.includes('umiera')).length, 1);
    assert.equal(result.battle.pending, null);
    assert.equal(call('next', {}, player).battle.fighters[1].id, b.fighters[2].id);
    assert.equal(call().battle.log.filter(e => e.includes('umiera')).length, 1);
    assert.equal(db.prepare('SELECT hp FROM game_monster_entries WHERE id = ?').get('ogre').hp, 80);
  } finally { db.close(); }
});

test('damage exceeding HP is fully retained with excess accounting and does not leak monster HP', () => {
  const { db, call, start, player } = fixture();
  try {
    const b = start().battle;
    const saved = JSON.parse(db.prepare('SELECT data FROM session_battles').get().data);
    saved.fighters[1].hp = 7; saved.fighters[1].tempHp = 2; saved.fighters[1].damageTaken = 0;
    db.prepare('UPDATE session_battles SET data = ?').run(JSON.stringify(saved));
    const result = call('act', { kind: 'resolve', note: 'Overkill test', targetId: b.fighters[1].id, effect: 'damage', amount: 25 });
    assert.equal(result.status, 200);
    const defeated = result.battle.defeatedMonsters[0];
    assert.equal(defeated.damageTaken, 25);
    assert.equal(defeated.overkillDamage, 16);
    assert.deepEqual(defeated.lastDamage, { amount: 25, hpBefore: 7, tempHpAbsorbed: 2, hpLost: 7, excess: 16 });
    const publicDefeated = call('', {}, player).battle.defeatedMonsters[0];
    assert.deepEqual(Object.keys(publicDefeated).sort(), ['damageTaken', 'id', 'name']);
    assert.equal(publicDefeated.damageTaken, 25);
    const pcDamage = call('act', { kind: 'resolve', note: 'Character overkill', targetId: b.fighters[0].id, effect: 'damage', amount: 100 });
    const pc = pcDamage.battle.fighters[0];
    assert.equal(pc.hp, 0); assert.equal(pc.damageTaken, 100); assert.equal(pc.overkillDamage, 67);
    const persisted = JSON.parse(db.prepare('SELECT data FROM session_battles').get().data);
    assert.equal(persisted.defeatedMonsters[0].overkillDamage, 16);
    assert.equal(persisted.fighters[0].overkillDamage, 67);
  } finally { db.close(); }
});

test('removing the current monster starts the next turn and removing a preceding monster preserves the current actor', () => {
  const { db, call, start } = fixture();
  try {
    const b = start().battle, monster = b.fighters[1];
    call('next');
    const killed = call('act', { kind: 'resolve', note: 'Lethal spell', effect: 'damage', targetId: monster.id, amount: 100 });
    assert.equal(killed.battle.fighters[killed.battle.turn].id, b.fighters[2].id);
    assert.equal(killed.battle.round, 1);
    assert.equal(killed.battle.fighters[killed.battle.turn].action, '');
    assert.equal(call('next').battle.round, 2);
  } finally { db.close(); }
});

test('GM monster attacks persist temporary HP absorption and actual character HP', () => {
  const { db, call, start, player } = fixture();
  try {
    const b = start().battle, targetId = b.fighters[0].id;
    call('next', {}, player);
    const attack = { id: 'club', name: 'Club', bonus: 5, dice: 1, sides: 8, damageBonus: 4 };
    assert.equal(call('act', { kind: 'attack', slot: 'bonus', targetId, roll: 15, attack }).status, 409);
    assert.equal(call('act', { kind: 'attack', slot: 'action', targetId, roll: 15, attack }).status, 200);
    assert.equal(call('act', { kind: 'damage', rolls: [8] }).status, 200);
    const values = JSON.parse(db.prepare('SELECT data FROM character_statistics WHERE character_id = 1').get().data).values;
    assert.equal(values.tempHp, 0); assert.equal(values.hp, 21);
    assert.equal(call().battle.fighters[0].hp, 21);
    const staleStats = JSON.parse(db.prepare('SELECT data FROM character_statistics WHERE character_id = 1').get().data);
    staleStats.values.hp = 30;
    let savedStatus;
    handleStatistics(db, player, '/api/characters/1/statistics', 'POST', staleStats, status => { savedStatus = status; });
    assert.equal(savedStatus, 409);
    assert.equal(JSON.parse(db.prepare('SELECT data FROM character_statistics WHERE character_id = 1').get().data).values.hp, 21);
  } finally { db.close(); }
});

test('GM resolves player spells and reactions, healing is capped and removed members cannot act', () => {
  const { db, call, start, player, other } = fixture();
  try {
    const b = start().battle;
    const requested = call('act', { kind: 'request', slot: 'bonus', description: 'Healing spell', roll: 15 }, player);
    assert.equal(requested.battle.pending.kind, 'request');
    assert.equal(call('act', { kind: 'resolve', note: 'heal' }, player).status, 409);
    const resolved = call('act', { kind: 'resolve', note: 'Heal 8', targetId: b.fighters[0].id, effect: 'heal', amount: 8 });
    assert.equal(resolved.battle.fighters[0].hp, 30); assert.equal(resolved.battle.pending, null);
    assert.equal(call('act', { kind: 'request', slot: 'bonus', description: 'Again' }, player).status, 409);
    const reaction = call('act', { kind: 'request', slot: 'reaction', actorId: b.fighters[2].id, description: 'Reaction' }, other);
    assert.equal(reaction.status, 200);
    call('act', { kind: 'resolve', note: 'Reaction resolved' });
    assert.equal(call('act', { kind: 'request', slot: 'reaction', actorId: b.fighters[2].id, description: 'Again' }, other).status, 409);
    db.prepare('DELETE FROM session_participants WHERE session_id = 1 AND member_id = 1').run();
    assert.equal(call('act', { kind: 'dodge' }, player).status, 404);
  } finally { db.close(); }
});

test('death saves, advantage cancellation and failed effects preserve persisted data', () => {
  const { db, call, start, player } = fixture();
  try {
    const b = start().battle;
    call('act', { kind: 'resolve', note: 'Damage', targetId: b.fighters[0].id, effect: 'damage', amount: 33 });
    assert.equal(call().battle.fighters[0].hp, 0);
    assert.equal(call('act', { kind: 'dodge' }, player).status, 409);
    assert.equal(call('act', { kind: 'death', roll: 20 }, player).battle.fighters[0].hp, 1);
    assert.equal(call('act', { kind: 'dodge' }, player).status, 200);
    const before = db.prepare('SELECT data FROM session_battles').get().data;
    assert.equal(call('act', { kind: 'resolve', note: 'Bad', targetId: 'missing', effect: 'damage', amount: 10 }).status, 409);
    assert.equal(db.prepare('SELECT data FROM session_battles').get().data, before);
    call('next');
    const attack = { id: 'club', name: 'Club', bonus: 5, dice: 1, sides: 8, damageBonus: 4 };
    const hit = call('act', { kind: 'attack', slot: 'action', targetId: b.fighters[0].id, roll: 15, advantage: true, attack });
    assert.equal(hit.status, 200); assert.equal(hit.battle.pending.kind, 'damage');
  } finally { db.close(); }
});


test('Fighter level two grants a separate non-Magic action, once per rest and turn', () => {
  const { db, call, start, player, other } = fixture();
  try {
    db.prepare('UPDATE characters SET level = 2 WHERE id = 1').run();
    start();
    assert.equal(call('act', { kind: 'action-surge' }, other).status, 409);
    assert.equal(call('act', { kind: 'action-surge' }, player).status, 200);
    assert.equal(call('act', { kind: 'cast', useActionSurge: true, slot: 'action' }, player).status, 409);
    assert.equal(call('act', { kind: 'dash', useActionSurge: true }, player).status, 200);
    const normal = call('act', { kind: 'dodge' }, player);
    assert.equal(normal.status, 200);
    assert.equal(normal.battle.fighters[0].action, 'Unik');
    assert.equal(call('act', { kind: 'help', useActionSurge: true }, player).status, 409);
    assert.equal(call('act', { kind: 'action-surge' }, player).status, 409);
    call('end');
    assert.equal(start().battle.fighters[0].actionSurgeUses, 0);
    call('end');
    let response;
    handleSpellResources(db, { id: 1, role: 'gm' }, '/api/games/1/spell-rest', 'POST', { rest: 'short' }, (status, data) => { response = { status, ...data }; });
    assert.equal(response.status, 200);
    assert.equal(start().battle.fighters[0].actionSurgeUses, 1);
  } finally { db.close(); }
});

test('Fighter level one cannot use level two features', () => {
  const { db, call, start, player } = fixture();
  try {
    db.prepare('UPDATE characters SET level = 1 WHERE id = 1').run();
    start();
    assert.equal(call('act', { kind: 'action-surge' }, player).status, 409);
    call('act', { kind: 'ability-check', ability: 'str', roll: 1, dc: 10 }, player);
    assert.equal(call('act', { kind: 'tactical-mind', roll: 10 }, player).status, 409);
  } finally { db.close(); }
});

test('Tactical Mind uses the server check total, preserves a failed use, and cannot repeat', () => {
  const { db, call, start, player } = fixture();
  try {
    db.prepare('UPDATE characters SET level = 2 WHERE id = 1').run();
    start();
    assert.equal(call('act', { kind: 'tactical-mind', roll: 10 }, player).status, 409);
    call('act', { kind: 'ability-check', ability: 'str', roll: 1, dc: 10 }, player);
    const failed = call('act', { kind: 'tactical-mind', roll: 1 }, player);
    assert.equal(failed.status, 200);
    assert.equal(failed.battle.fighters[0].secondWindUses, 2);
    assert.equal(call('act', { kind: 'tactical-mind', roll: 10 }, player).status, 409);
    call('act', { kind: 'ability-check', ability: 'str', roll: 1, dc: 10 }, player);
    const success = call('act', { kind: 'tactical-mind', roll: 6 }, player);
    assert.equal(success.battle.fighters[0].lastAbilityCheck.total, 10);
    assert.equal(success.battle.fighters[0].secondWindUses, 1);
    assert.equal(success.battle.fighters[0].bonus, '');
    assert.equal(resourceState(db, 1).secondWindUses, 1);
    call('act', { kind: 'saving-throw', ability: 'str', roll: 1 }, player);
    assert.equal(call('act', { kind: 'tactical-mind', roll: 10 }, player).status, 409);
  } finally { db.close(); }
});

test('Second Wind caps legacy level seventeen resources at four', () => {
  const { db, start } = fixture();
  try {
    db.prepare('UPDATE characters SET level = 17 WHERE id = 1').run();
    saveResources(db, 1, { ...resourceState(db, 1), secondWindUses: 5 });
    const f = start().battle.fighters[0];
    assert.equal(f.secondWindMax, 4);
    assert.equal(f.secondWindUses, 4);
  } finally { db.close(); }
});

test('Nick requires the chosen mastery and cannot grant an unrestricted extra attack', () => {
  for (const selected of [false, true]) {
    const { db, call, start, player } = fixture();
    try {
      db.prepare('UPDATE characters SET level = 1 WHERE id = 1').run();
      db.exec("UPDATE character_items SET weapon_id = 'shortsword' WHERE id = 1; INSERT INTO character_items (id,character_id,name,quantity,slot,equipped,weapon_id) VALUES (3,1,'Dagger',1,'off-hand',1,'dagger')");
      if (selected) db.prepare("UPDATE character_statistics SET data = json_set(data, '$.choices.weaponMastery', json(?)) WHERE character_id = 1").run(JSON.stringify(['dagger']));
      const b = start().battle, targetId = b.fighters[1].id;
      call('act', { kind: 'attack', slot: 'action', attackId: '1', targetId, roll: 1 }, player);
      assert.equal(call('act', { kind: 'attack', slot: 'action', attackId: 'unarmed', targetId, roll: 1 }, player).status, 409);
      assert.equal(call('act', { kind: 'attack', slot: 'action', attackId: '3', targetId, roll: 1 }, player).status, selected ? 200 : 409);
      if (selected) assert.equal(call('act', { kind: 'attack', slot: 'bonus', attackId: '3', targetId, roll: 1 }, player).status, 409);
    } finally { db.close(); }
  }
});

test('Fighter choice edits require a level gain or one unused long rest', () => {
  const { db, player } = fixture();
  try {
    db.prepare('UPDATE characters SET level = 1 WHERE id = 1').run();
    const edit = (body) => {
      let result;
      handleStatistics(db, player, '/api/characters/1/choices', 'POST', body,
        (status, data) => { result = { status, ...data }; });
      return result;
    };
    const first = { fightingStyle: 'defense', weaponMastery: ['dagger', 'longsword', 'shortsword'] };
    assert.equal(edit(first).status, 200);
    assert.equal(edit({ ...first, fightingStyle: 'archery' }).status, 400);
    const replaced = { ...first, weaponMastery: ['dagger', 'longsword', 'shortbow'] };
    assert.equal(edit(replaced).status, 400);
    saveResources(db, 1, { ...resourceState(db, 1), lastLongRest: 100 });
    assert.equal(edit(replaced).status, 200);
    assert.equal(edit(first).status, 400);
    saveResources(db, 1, { ...resourceState(db, 1), lastLongRest: 200 });
    assert.equal(edit({ ...first, weaponMastery: ['spear', 'longbow', 'shortbow'] }).status, 400);
    assert.equal(edit(first).status, 200);
    db.prepare('UPDATE characters SET level = 2 WHERE id = 1').run();
    assert.equal(edit({ ...first, fightingStyle: 'archery' }).status, 200);
    assert.equal(edit(first).status, 400);
    // Forged progression fields never replace server history.
    assert.equal(edit({ ...first, fighterChoices: { styleLevel: 0 } }).status, 400);
  } finally { db.close(); }
});

test('Two-Weapon Fighting retains its modifier when executing the bonus attack', () => {
  const { db, call, start, player } = fixture();
  try {
    db.exec("UPDATE character_items SET weapon_id = 'shortsword' WHERE id = 1; INSERT INTO character_items (id,character_id,name,quantity,slot,equipped,weapon_id) VALUES (3,1,'Dagger',1,'off-hand',1,'dagger')");
    db.prepare("UPDATE character_statistics SET data = json_set(data, '$.choices.fightingStyle', 'two-weapon-fighting') WHERE character_id = 1").run();
    const targetId = start().battle.fighters[1].id;
    call('act', { kind: 'attack', slot: 'action', attackId: '1', targetId, roll: 1 }, player);
    const hit = call('act', { kind: 'attack', slot: 'bonus', attackId: '3', targetId, roll: 20 }, player);
    assert.equal(hit.status, 200);
    assert.equal(hit.battle.pending.attack.damageBonus, 3);
  } finally { db.close(); }
});


test('Psi Warrior level three: weapon strike spends its own die and rejects invalid dice atomically', () => {
  const { db, call, start, player } = fixture();
  try {
    db.prepare("UPDATE characters SET subclass = 'Psi Warrior', level = 3 WHERE id = 1").run();
    const b = start().battle, targetId = b.fighters[1].id;
    assert.equal(b.fighters[0].psiUses, 4);
    assert.equal(b.fighters[0].psiSides, 6);
    call('act', { kind: 'attack', slot: 'action', attackId: '1', targetId, roll: 20 }, player);
    assert.equal(call('act', { kind: 'damage', rolls: [2, 2], psiRoll: 7, psiConfirmed: true }, player).status, 409);
    assert.equal(call().battle.fighters[0].psiUses, 4);
    const hit = call('act', { kind: 'damage', rolls: [2, 2], psiRoll: 6, psiConfirmed: true }, player);
    assert.equal(hit.status, 200);
    assert.equal(hit.battle.fighters[0].psiUses, 3);
    assert.equal(hit.battle.fighters[0].psiStrikeUsed, true);
    assert.equal(resourceState(db, 1).psiUses, 3);
  } finally { db.close(); }
});

test('Protective Field reduces incoming damage before temporary HP and consumes reaction', () => {
  const { db, call, start, player, other } = fixture();
  try {
    db.prepare("UPDATE characters SET subclass = 'Psi Warrior', level = 3 WHERE id = 1").run();
    const id = start().battle.fighters[0].id;
    call('next');
    const attack = { id: 'club', name: 'Club', bonus: 5, dice: 1, sides: 8, damageBonus: 4 };
    call('act', { kind: 'attack', slot: 'action', targetId: id, roll: 15, attack });
    const field = { kind: 'protective-field', actorId: id, targetId: id, roll: 6, psiConfirmed: true };
    assert.equal(call('act', field, other).status, 409);
    assert.equal(call('act', { ...field, roll: undefined }, player).status, 409);
    assert.equal(call('act', field, player).status, 200);
    assert.equal(call('act', field, player).status, 409);
    const result = call('act', { kind: 'damage', rolls: [8] });
    assert.equal(result.status, 200);
    assert.equal(result.battle.fighters.find(f => f.id === id).hp, 27);
    assert.equal(resourceState(db, 1).psiUses, 3);
  } finally { db.close(); }
});

test('Telekinetic Movement is a Magic action with separate rest recovery and die restoration', () => {
  const { db, call, start, player } = fixture();
  try {
    db.prepare("UPDATE characters SET subclass = 'Psi Warrior', level = 3 WHERE id = 1").run();
    start();
    const move = { kind: 'telekinetic-movement', description: 'Move a willing ally to an empty space within 30 feet', psiConfirmed: true };
    assert.equal(call('act', { ...move, useActionSurge: true }, player).status, 409);
    assert.equal(call('act', move, player).status, 200);
    assert.equal(resourceState(db, 1).telekineticMovementAvailable, false);
    call('act', { kind: 'resolve', note: 'Moved' });
    assert.equal(call('act', { kind: 'restore-telekinetic-movement' }, player).status, 200);
    assert.equal(resourceState(db, 1).psiUses, 3);
    assert.equal(call('act', move, player).status, 409);
    call('end');
    let response;
    handleSpellResources(db, { id: 1, role: 'gm' }, '/api/games/1/spell-rest', 'POST', { rest: 'short' }, (status, data) => { response = { status, ...data }; });
    assert.equal(response.status, 200);
    assert.equal(resourceState(db, 1).psiUses, 4);
    assert.equal(start().battle.fighters[0].telekineticMovementAvailable, true);
  } finally { db.close(); }
});

test('Psi Warrior powers are unavailable below level three or for another subclass', () => {
  for (const [level, subclass] of [[2, 'Psi Warrior'], [3, 'Champion']]) {
    const { db, call, start, player } = fixture();
    try {
      db.prepare('UPDATE characters SET subclass = ?, level = ? WHERE id = 1').run(subclass, level);
      assert.equal(start().battle.fighters[0].psiMax, 0);
      assert.equal(call('act', { kind: 'telekinetic-movement', description: 'Object', psiConfirmed: true }, player).status, 409);
    } finally { db.close(); }
  }
});


test('Protective Field reduces spell damage before resistance', () => {
  const { db, call, start, player } = fixture();
  try {
    db.prepare("UPDATE characters SET subclass = 'Psi Warrior', level = 3 WHERE id = 1").run();
    const b = start().battle, id = b.fighters[0].id;
    b.pending = { kind: 'spell', actorId: b.fighters[1].id, spellName: 'Test force spell', stage: 'effect',
      spec: { mode: 'save', dice: 2, sides: 6, bonus: 0, type: 'moc' },
      targets: [{ id, saved: false, defenseReady: true, multiplier: 0.5 }] };
    db.prepare('UPDATE session_battles SET data = ? WHERE session_id = 1').run(JSON.stringify(b));
    assert.equal(call('act', { kind: 'protective-field', actorId: id, targetId: id, roll: 6, psiConfirmed: true }, player).status, 200);
    const effect = call('act', { kind: 'spell-effect', rolls: [6, 6] });
    assert.equal(effect.status, 200);
    assert.equal(effect.battle.fighters[0].hp, 30);
    assert.equal(effect.battle.fighters[0].tempHp, 0);
    assert.equal(effect.battle.fighters[0].damageTaken, 3);
  } finally { db.close(); }
});
