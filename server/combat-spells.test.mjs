import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from './db.mjs';
import { emptyStatistics } from './statistics.mjs';
import { handleBattles } from './battles.mjs';
import { handleSpellResources, resourceState, publicCaster, saveResources, speciesResourceState } from './spell-resources.mjs';
import progression from '../shared/spell-progression.json' with { type: 'json' };
import { exportRows, hydrate } from './firestore.mjs';

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
        : { spellId: 'hellish-rebuke', source: 'pact', level: 5, slot: 'reaction' };
      assert.equal(call('act', { kind: 'cast', ...body }).status, 200);
      assert.equal(rest('long').status, 409);
      call('end', {}, gm);
      assert.equal(rest('long', player).status, 404);
      assert.equal(rest('short').status, 200);
      assert.equal(resourceState(db, 1).spent[0], classId === 'bard' ? 1 : 0);
      assert.equal(resourceState(db, 1).pactSpent, 0);
      if (classId === 'warlock') {
        start();
        assert.equal(call('act', { kind: 'cast', slot: 'action', spellId: 'circle-of-death', source: 'arcanum', level: 6 }).status, 200);
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
    assert.equal(shield.battle.fighters[0].ac, 17);
    assert.equal(shield.battle.pending, null);
    assert.equal(resourceState(db, 1).spent[0], 1);
    call('next', {}, gm); call('next', {}, gm);
    assert.equal(call().battle.fighters[0].ac, 12);
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
