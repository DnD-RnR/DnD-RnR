import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from './db.mjs';
import { emptyStatistics } from './statistics.mjs';
import { handleBattles } from './battles.mjs';
import { handleStatistics } from './statistics.mjs';
import { handleGames } from './games.mjs';
import { exportRows, hydrate } from './firestore.mjs';

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
    assert.equal(playerView.battle.fighters[0].ac, 15);
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
