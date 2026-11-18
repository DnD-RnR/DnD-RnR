import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from './db.mjs';
import { emptyStatistics } from './statistics.mjs';
import { handleBattles } from './battles.mjs';
import { handleSpellResources, resourceState, saveResources } from './spell-resources.mjs';
import { statisticsSummary } from './statistics-summary.mjs';
import { characterTraits } from '../shared/character-traits.mjs';
import { advancementPreview, levelFeatOptions } from '../shared/advancement.mjs';
import { weaponMasteryChoicesValid } from '../shared/weapon-mastery.mjs';
import { exportRows, hydrate } from './firestore.mjs';
import { applyTimedEffect } from './timed-effects.mjs';

const cls = 'Barbarzyńca (Barbarian)';
function fixture(subclass = 'Path of the Berserker', level = 14, traits = {}) {
  const db = openDatabase(':memory:');
  db.exec(`INSERT INTO users VALUES (1,'gm','GM','unused','gm'),(2,'hero','Hero','unused','player'),(3,'ally','Ally','unused','player');
    INSERT INTO games (id,gm_id,name) VALUES (1,1,'Game');
    INSERT INTO game_sessions (id,game_id,started_at) VALUES (1,1,1);
    INSERT INTO characters (id,user_id,name,class,level) VALUES (1,2,'Hero','Fighter',5),(2,3,'Ally','Bard',1);
    INSERT INTO game_members (id,game_id,character_id,status) VALUES (1,1,1,'accepted'),(2,1,2,'accepted');
    INSERT INTO session_participants VALUES (1,1,1),(1,2,1);
    INSERT INTO game_monster_entries VALUES (1,'ogre','Ogre',100,12,30,'','{"str":0,"dex":0,"con":0,"int":0,"wis":0,"cha":0}');
    INSERT INTO character_items (id,character_id,name,quantity,slot,equipped,weapon_id) VALUES (1,1,'Sword',1,'main-hand',1,'longsword');`);
  db.prepare('UPDATE characters SET class = ?, species = ?, level = ?, subclass = ? WHERE id = 1').run(cls, 'Elf', level, subclass);
  const stats = emptyStatistics(); Object.assign(stats.values, { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 12, hp: 60, maxHp: 80, tempHp: 0, speed: null }); stats.traits = traits;
  for (const id of [1, 2]) db.prepare('INSERT INTO character_statistics VALUES (?, ?)').run(id, JSON.stringify(stats));
  const gm = { id: 1, role: 'gm' }, player = { id: 2, role: 'player' }, ally = { id: 3, role: 'player' }; let version = 0;
  const call = (action = '', body = {}, user = gm) => {
    let result; handleBattles(db, user, `/api/games/1/battle${action ? '/' + action : ''}`, action ? 'POST' : 'GET', { sessionId: 1, version, ...body }, (status, data) => { result = { status, ...data }; });
    if (result.battle) version = result.battle.version; return result;
  };
  const start = (extra = {}) => call('start', { fighters: [{ memberId: 1, initiative: 20, ...extra }, { enemyId: 'ogre', initiative: 10 }, { memberId: 2, initiative: 5 }] });
  const act = (kind, body = {}, user = player) => call('act', { kind, ...body }, user);
  const ok = result => { assert.equal(result.status, 200, result.error); return result; };
  const round = () => { ok(call('next')); ok(call('next')); return ok(call('next')); };
  const mutate = fn => { const b = JSON.parse(db.prepare('SELECT data FROM session_battles').get().data); fn(b); db.prepare('UPDATE session_battles SET data = ?').run(JSON.stringify(b)); };
  const rest = type => { let result; handleSpellResources(db, gm, '/api/games/1/spell-rest', 'POST', { rest: type }, (status, data) => { result = { status, ...data }; }); return result; };
  const hit = (extra = {}) => { const b = call().battle; return act('attack', { slot: 'action', attackId: '1', targetId: b.fighters[1].id, roll: 15, ...extra }); };
  return { db, stats, call, start, act, ok, round, mutate, rest, hit, gm, player, ally };
}

test('Fast Movement excludes heavy armor; Feral Instinct rolls two dice with ability modifiers', () => {
  const f = fixture('Path of the Berserker', 7);
  try {
    const c = f.db.prepare('SELECT * FROM characters WHERE id = 1').get();
    assert.equal(statisticsSummary(c, f.stats).speed, 40);
    assert.equal(statisticsSummary(c, f.stats, [{ equipped: 1, armorCategory: 'heavy', armorClass: '18' }]).speed, 30);
    assert.equal(f.start({ initiativeRoll: 2 }).status, 409);
    const b = f.ok(f.start({ initiativeRoll: 2, initiativeRoll2: 19 })).battle;
    assert.equal(b.fighters[0].initiative, 20);
    assert.equal(weaponMasteryChoicesValid(c, ['longbow']), false);
    assert.equal(weaponMasteryChoicesValid(c, ['longsword']), true);
  } finally { f.db.close(); }
});

test('Indomitable Might uses Strength as a floor for both checks and saves', () => {
  const f = fixture('Path of the Berserker', 18);
  try {
    f.ok(f.start());
    assert.match(f.ok(f.act('ability-check', { ability: 'str', roll: 1 })).battle.log.at(-1), /16\./);
    assert.match(f.ok(f.act('saving-throw', { ability: 'str', roll: 1 })).battle.log.at(-1), /16\./);
    assert.match(f.ok(f.act('saving-throw', { ability: 'dex', roll: 1, roll2: 2 })).battle.log.at(-1), /3\./);
  } finally { f.db.close(); }
});

test('Brutal Strike trades advantage for damage, rejects disadvantage and limits usage', () => {
  const f = fixture('Path of the Wild Heart', 9);
  try {
    f.ok(f.start()); f.ok(f.act('rage', { animal: 'bear' }));
    assert.equal(f.hit({ reckless: true, brutal: true, disadvantage: true }).status, 409);
    const p = f.ok(f.hit({ reckless: true, brutal: true })).battle.pending;
    assert.equal(p.brutal, true);
    assert.equal(f.act('damage', { rolls: [3], brutalRolls: [], brutalEffects: ['hamstring'] }).status, 409);
    f.ok(f.act('damage', { rolls: [3], brutalRolls: [7], brutalEffects: ['hamstring'] }));
    const b = f.call().battle;
    assert.equal(b.fighters[1].hp, 84); assert.equal(b.fighters[1].speed, 15);
    assert.equal(f.hit({ brutal: true }).status, 409);
    f.round(); assert.equal(f.call().battle.fighters[1].speed, 30);
  } finally { f.db.close(); }
});

test('Improved Brutal Strike permits two distinct effects and two k10 at level 17', () => {
  const f = fixture('Path of the World Tree', 17);
  try {
    f.ok(f.start()); f.ok(f.hit({ reckless: true, brutal: true, roll: 20 }));
    assert.equal(f.act('damage', { rolls: [3, 3], brutalRolls: [4, 4], brutalEffects: ['hamstring', 'sundering'] }).status, 409);
    f.ok(f.act('damage', { rolls: [3, 3], brutalRolls: [4, 4, 4, 4], brutalEffects: ['hamstring', 'sundering'] }));
    assert.equal(f.call().battle.fighters[1].hp, 75);
    f.ok(f.call('next')); f.ok(f.call('next'));
    const targetId = f.call().battle.fighters[1].id;
    const attack = f.ok(f.act('attack', { slot: 'action', attackId: 'unarmed', targetId, roll: 5 }, f.ally));
    assert.equal(attack.battle.pending.kind, 'damage');
    assert.equal(f.call().battle.fighters[1].brutalEffects.some(e => e.kind === 'sundering'), false);
  } finally { f.db.close(); }
});

test('Mindless Rage ends existing fear and charm and rejects new sources while active', () => {
  const f = fixture('Path of the Berserker', 6);
  try {
    const b = f.ok(f.start()).battle, actorId = b.fighters[0].id, targetId = b.fighters[1].id;
    f.ok(f.act('condition-source', { actorId, sourceId: targetId, condition: 'frightened', enabled: true, sourceName: 'Ogre', visible: true }, f.gm));
    f.ok(f.act('rage'));
    assert.equal(f.call().battle.fighters[0].conditionSources.length, 0);
    assert.equal(f.act('condition-source', { actorId, sourceId: targetId, condition: 'charmed', enabled: true, sourceName: 'Ogre' }, f.gm).status, 409);
  } finally { f.db.close(); }
});

test('Retaliation uses a reaction and its owner resolves damage outside their turn', () => {
  const f = fixture('Path of the Berserker', 10);
  try {
    const b = f.ok(f.start()).battle, actorId = b.fighters[0].id, targetId = b.fighters[1].id;
    f.ok(f.call('next'));
    f.ok(f.act('attack', { slot: 'action', targetId: actorId, attack: { name: 'Club', bonus: 10, dice: 1, sides: 6, damageBonus: 0, type: 'obuchowe' }, roll: 15 }, f.gm));
    f.ok(f.act('damage', { rolls: [6] }, f.gm));
    assert.equal(f.act('attack', { actorId, slot: 'reaction', attackId: '1', targetId, roll: 15 }).status, 409);
    f.ok(f.act('attack', { actorId, slot: 'reaction', attackId: '1', targetId, within5Feet: true, roll: 15 }));
    f.ok(f.act('damage', { rolls: [4] }));
    assert.equal(f.call().battle.fighters[1].hp, 93);
    assert.equal(f.call().battle.fighters[0].action, '');
  } finally { f.db.close(); }
});

test('Intimidating Presence applies fear, supports monster repeat saves and restores with Rage', () => {
  const f = fixture();
  try {
    const targetId = f.ok(f.start()).battle.fighters[1].id;
    f.ok(f.act('barb-intimidating', { targetIds: [targetId], confirmed: true }));
    f.ok(f.act('spell-save', { targetId, roll: 1 }, f.gm)); f.ok(f.act('spell-defense', { targetId, multiplier: 1 }, f.gm)); f.ok(f.act('spell-effect', { rolls: [] }));
    f.ok(f.call('next')); assert.equal(f.call('next').status, 409);
    const effectId = f.call().battle.fighters[1].barbarianFears[0].id;
    f.ok(f.act('barb-fear-save', { actorId: targetId, effectId, roll: 20 }, f.gm));
    f.ok(f.call('next')); f.ok(f.call('next'));
    assert.equal(f.act('barb-intimidating', { targetIds: [], confirmed: true }).status, 409);
    f.ok(f.act('barb-intimidating', { targetIds: [], confirmed: true, restore: true }));
    assert.equal(resourceState(f.db, 1).rageUses, 4);
  } finally { f.db.close(); }
});

test('Wild Heart aspects grant correct senses and movement; level 14 power is mandatory', () => {
  for (const aspect of ['owl', 'panther', 'salmon']) {
    const f = fixture('Path of the Wild Heart', 14, { wildAspect: [aspect] });
    try {
      const c = f.db.prepare('SELECT * FROM characters WHERE id = 1').get(), traits = characterTraits(c, f.stats);
      if (aspect === 'owl') assert.equal(traits.darkvision, 120);
      if (aspect === 'panther') assert.equal(traits.climbSpeed, 40);
      if (aspect === 'salmon') assert.equal(traits.swimSpeed, 40);
      f.ok(f.start()); assert.equal(f.act('rage', { animal: 'eagle' }).status, 409);
      const rage = f.ok(f.act('rage', { animal: 'eagle', power: 'falcon' })).battle.fighters[0];
      assert.equal(rage.flySpeed, 40); assert.equal(rage.extraMove, 40); assert.equal(rage.disengaged, true);
    } finally { f.db.close(); }
  }
});

test('World Tree vitality grants temporary HP, gift once at turn start and removes it when Rage ends', () => {
  const f = fixture('Path of the World Tree', 3);
  try {
    const b = f.ok(f.start()).battle, targetId = b.fighters[2].id;
    f.ok(f.act('rage')); assert.equal(f.call().battle.fighters[0].tempHp, 3);
    f.round(); f.ok(f.act('barb-life-gift', { targetId, rolls: [5, 5], confirmed: true }));
    assert.equal(f.call().battle.fighters[2].tempHp, 10);
    assert.equal(f.act('barb-life-gift', { targetId, rolls: [5, 5], confirmed: true }).status, 409);
    f.ok(f.act('rage-end')); assert.equal(f.call().battle.fighters[2].tempHp, 0);
  } finally { f.db.close(); }
});

test('World Tree Branches teleports a failed STR target and holds it until the current turn ends', () => {
  const f = fixture('Path of the World Tree', 6);
  try {
    const b = f.ok(f.start()).battle, actorId = b.fighters[0].id, targetId = b.fighters[1].id;
    f.ok(f.act('rage')); f.ok(f.call('next'));
    f.ok(f.act('barb-branches', { actorId, confirmed: true, hold: true }));
    f.ok(f.act('spell-save', { targetId, roll: 1 }, f.gm)); f.ok(f.act('spell-defense', { targetId, multiplier: 1 }, f.gm)); f.ok(f.act('spell-effect', { rolls: [] }));
    assert.equal(f.call().battle.fighters[1].speed, 0);
    assert.equal(f.act('move', { feet: 1 }, f.gm).status, 409);
    f.ok(f.call('next')); assert.equal(f.call().battle.fighters[1].speed, 30);
  } finally { f.db.close(); }
});

test('World Tree extended travel is once per Rage and its activation teleport shares the Rage bonus action', () => {
  const f = fixture('Path of the World Tree', 14);
  try {
    const b = f.ok(f.start()).battle; f.ok(f.act('rage'));
    f.ok(f.act('barb-travel', { confirmed: true, extended: true, targetIds: [b.fighters[2].id] }));
    f.round(); assert.equal(f.act('barb-travel', { confirmed: true, extended: true, targetIds: [] }).status, 409);
    f.ok(f.act('barb-travel', { confirmed: true, targetIds: [] }));
    assert.equal(f.act('barb-travel', { confirmed: true, targetIds: [] }).status, 409);
  } finally { f.db.close(); }
});

test('Zealot Divine Fury triggers on the first hit; healing dice persist across combat and rest', () => {
  const f = fixture('Path of the Zealot', 6);
  try {
    f.ok(f.start()); f.ok(f.act('rage')); f.ok(f.hit());
    assert.equal(f.act('damage', { rolls: [3] }).status, 409);
    f.ok(f.act('damage', { rolls: [3], divineRolls: [4], divineType: 'promieniste' }));
    assert.equal(f.call().battle.fighters[1].hp, 85);
    f.round(); f.ok(f.act('barb-heal', { rolls: [3, 4] }));
    assert.equal(resourceState(f.db, 1).zealotDiceSpent, 2);
    f.ok(f.call('end')); f.ok(f.rest('short')); assert.equal(resourceState(f.db, 1).zealotDiceSpent, 2);
    const restored = hydrate(exportRows(f.db)); try { assert.equal(resourceState(restored, 1).zealotDiceSpent, 2); } finally { restored.close(); }
    f.ok(f.rest('long')); assert.equal(resourceState(f.db, 1).zealotDiceSpent, 0);
  } finally { f.db.close(); }
});

test('Zealot Fanatical Focus pauses a failed save, adds Rage damage bonus and is once per Rage', () => {
  const f = fixture('Path of the Zealot', 6);
  try {
    const b = f.ok(f.start()).battle, actorId = b.fighters[0].id;
    f.ok(f.act('rage'));
    f.mutate(b => { b.pending = { kind: 'spell', actorId: b.fighters[1].id, spellName: 'Test', spec: { mode: 'save', save: 'wis', dice: 1, sides: 6, bonus: 0, type: 'Fire', half: true }, stage: 'save', dc: 12, targets: [{ id: actorId }] }; });
    const failed = f.ok(f.act('spell-save', { targetId: actorId, roll: 1 }));
    assert.equal(failed.battle.pending.fanaticalTargetId, actorId);
    assert.equal(f.act('spell-effect', { rolls: [3] }, f.gm).status, 409);
    f.ok(f.act('barb-fanatical', { actorId, roll: 10 }));
    assert.equal(f.call().battle.pending.targets[0].saved, true);
    assert.equal(f.call().battle.fighters[0].rage.fanaticalUsed, true);
  } finally { f.db.close(); }
});

test('Zealot presence grants ally attack/save advantage; divine form flies, resists and revivifies', () => {
  const f = fixture('Path of the Zealot', 14);
  try {
    const b = f.ok(f.start()).battle, actorId = b.fighters[0].id, targetId = b.fighters[2].id;
    f.ok(f.act('rage', { divineForm: true }));
    assert.equal(f.call().battle.fighters[0].flySpeed, 40); assert.equal(f.call().battle.fighters[0].canHover, true);
    f.round(); f.ok(f.act('barb-zealous', { targetIds: [targetId], confirmed: true }));
    assert.ok(f.call().battle.fighters[2].barbarianPresence);
    f.ok(f.call('next'));
    f.ok(f.act('attack', { slot: 'action', targetId, attack: { name: 'Club', bonus: 20, dice: 1, sides: 100, damageBonus: 0, type: 'obuchowe' }, roll: 15 }, f.gm));
    f.ok(f.act('barb-revivification', { actorId, targetId, confirmed: true }));
    f.ok(f.act('damage', { rolls: [80] }, f.gm)); assert.equal(f.call().battle.fighters[2].hp, 14);
    assert.equal(resourceState(f.db, 1).divineFormUsed, true);
  } finally { f.db.close(); }
});

test('Epic Boons unlock at 19, raise one ability and keep the capstone calculation', () => {
  const f = fixture('Path of the Berserker', 18);
  try {
    const c = f.db.prepare('SELECT * FROM characters WHERE id = 1').get();
    assert.equal(levelFeatOptions(c, f.stats).some(e => e.category === 'Epic Boon'), false);
    assert.equal(levelFeatOptions({ ...c, level: 19 }, f.stats).filter(e => e.category === 'Epic Boon').length, 6);
    const next = advancementPreview(c, f.stats, { featMode: 'feat', feat: 'Boon of Irresistible Offense', increases: { str: 1 } });
    assert.equal(next.statistics.values.str, 17); assert.equal(next.statistics.levelFeats[0].ability, 'str');
    assert.equal(advancementPreview(next.character, next.statistics, {}).statistics.values.str, 21);
  } finally { f.db.close(); }
});

test('Combat Prowess converts a miss and Irresistible Offense ignores physical resistance', () => {
  const f = fixture('Path of the World Tree', 19);
  try {
    f.stats.levelFeats = [{ name: 'Boon of Combat Prowess', level: 19 }, { name: 'Boon of Irresistible Offense', level: 19, ability: 'str' }];
    f.db.prepare('UPDATE character_statistics SET data = ? WHERE character_id = 1').run(JSON.stringify(f.stats));
    f.ok(f.start()); f.ok(f.hit({ roll: 1 }));
    f.ok(f.act('epic-prowess')); f.mutate(b => { b.fighters[1].damageResistance = 'cięte'; });
    f.ok(f.act('damage', { rolls: [3] })); assert.equal(f.call().battle.fighters[1].hp, 94);
    f.ok(f.hit({ roll: 1 })); assert.equal(f.act('epic-prowess').status, 409);
  } finally { f.db.close(); }
});

test('Improve Fate can change a just-rolled attack outcome and restores on Initiative', () => {
  const f = fixture('Path of the World Tree', 19);
  try {
    f.stats.levelFeats = [{ name: 'Boon of Fate', level: 19 }]; f.db.prepare('UPDATE character_statistics SET data = ? WHERE character_id = 1').run(JSON.stringify(f.stats));
    f.ok(f.start()); f.ok(f.hit({ roll: 2 }));
    f.ok(f.act('epic-fate', { rolls: [4, 4], sign: 1, confirmed: true }));
    assert.equal(f.call().battle.pending.kind, 'damage'); assert.equal(resourceState(f.db, 1).epicFateUsed, true);
    f.ok(f.act('damage', { rolls: [3] })); f.ok(f.call('end')); f.ok(f.start()); assert.equal(resourceState(f.db, 1).epicFateUsed, false);
  } finally { f.db.close(); }
});

test('Battering Roots extends eligible weapon reach only on the owner turn and resolves Topple', () => {
  const f = fixture('Path of the World Tree', 10);
  try {
    const b = f.ok(f.start()).battle;
    assert.equal(b.fighters[0].attacks.find(a => a.id === '1').reach, 15);
    f.ok(f.hit()); f.ok(f.act('damage', { rolls: [3], roots: 'topple', rootSave: { roll: 1 }, confirmed: true }));
    assert.equal(f.call().battle.fighters[1].prone, true);
    f.ok(f.call('next')); assert.equal(f.call().battle.fighters[0].attacks.find(a => a.id === '1').reach, 5);
  } finally { f.db.close(); }
});

test('Staggering Blow consumes disadvantage on exactly one save and retains the opportunity restriction', () => {
  const f = fixture('Path of the World Tree', 13);
  try {
    const b = f.ok(f.start()).battle, targetId = b.fighters[1].id;
    f.ok(f.hit({ reckless: true, brutal: true })); f.ok(f.act('damage', { rolls: [3], brutalRolls: [5], brutalEffects: ['staggering'] }));
    f.mutate(b => { b.pending = { kind: 'spell', actorId: b.fighters[0].id, spellName: 'Test', spec: { mode: 'save', save: 'dex', dice: 1, sides: 6, type: 'Fire', half: true, bonus: 0 }, stage: 'save', dc: 10, targets: [{ id: targetId }] }; });
    assert.equal(f.act('spell-save', { targetId, roll: 20 }, f.gm).status, 409);
    f.ok(f.act('spell-save', { targetId, roll: 20, roll2: 1 }, f.gm));
    const effects = f.call().battle.fighters[1].brutalEffects;
    assert.equal(effects.some(e => e.kind === 'stagger-save'), false); assert.equal(effects.some(e => e.kind === 'no-opportunity'), true);
    assert.equal(f.call().battle.pending.targets[0].saved, false);
  } finally { f.db.close(); }
});

test('Lion applies disadvantage against allies while Ram knocks down an eligible melee target', () => {
  for (const power of ['lion', 'ram']) {
    const f = fixture('Path of the Wild Heart', 14, { wildAspect: ['owl'] });
    try {
      const b = f.ok(f.start()).battle, actorId = b.fighters[0].id, targetId = b.fighters[1].id;
      f.ok(f.act('base-size', { actorId: targetId, size: 'Large' }, f.gm));
      f.ok(f.act('rage', { animal: 'bear', power }));
      if (power === 'ram') {
        f.ok(f.hit()); f.ok(f.act('damage', { rolls: [3], ram: true })); assert.equal(f.call().battle.fighters[1].prone, true);
      } else {
        f.ok(f.act('barb-lion-targets', { actorId, targetIds: [targetId], confirmed: true }, f.gm)); f.ok(f.call('next'));
        const attack = { slot: 'action', targetId: b.fighters[2].id, attack: { name: 'Club', bonus: 0, dice: 1, sides: 6, damageBonus: 0, type: 'obuchowe' }, roll: 20 };
        assert.equal(f.act('attack', attack, f.gm).status, 409);
        f.ok(f.act('attack', { ...attack, roll2: 1 }, f.gm)); assert.equal(f.call().battle.pending, null);
      }
    } finally { f.db.close(); }
  }
});

test('Relentless Rage applies Bless and Mind Sliver, with Fanatical Focus preserving the original modifiers', () => {
  const f = fixture('Path of the Zealot', 11);
  try {
    f.ok(f.start()); f.ok(f.act('rage'));
    f.mutate(b => {
      const hero = b.fighters[0]; hero.hp = 0; hero.relentlessRagePending = { dc: 10 };
      const ally = b.fighters[2]; ally.concentration = 'Bless'; ally.concentrationKey = 'bless-test';
      const state = resourceState(f.db, 2); state.concentration = 'Bless'; state.concentrationKey = 'bless-test'; saveResources(f.db, 2, state);
      applyTimedEffect(f.db, b, ally, hero, { id: 'bless', name: 'Bless', level: 1 }, 1, 'bless-test');
      hero.spellConditions = [{ kind: 'mind-sliver', sourceId: b.fighters[1].id, expiresRound: 3 }];
    });
    f.ok(f.act('relentless-rage', { roll: 1, blessRoll: 3, mindSliverRoll: 4, fanaticalRoll: 2 }));
    assert.equal(f.call().battle.fighters[0].hp, 22); // 2 + (CON save 6 + Bless 3 - Sliver 4) + Rage 3 = 10.
    assert.equal(f.call().battle.fighters[0].rage.fanaticalUsed, true);
    assert.equal(resourceState(f.db, 1).relentlessRageDC, 15);
  } finally { f.db.close(); }
});

test('Fanatical Focus retains one-shot save modifiers and ordinary-save rerolls require a failed result', () => {
  const f = fixture('Path of the Zealot', 6);
  try {
    f.ok(f.start()); f.ok(f.act('rage'));
    f.ok(f.act('saving-throw', { ability: 'wis', roll: 1 }));
    assert.equal(f.act('barb-fanatical-check', { dc: 1, roll: 20, confirmed: true }).status, 409);
    f.ok(f.act('barb-fanatical-check', { dc: 12, roll: 10, confirmed: true }));
    assert.match(f.call().battle.log.at(-1), /12/);
    assert.equal(f.act('barb-fanatical-check', { dc: 20, roll: 20, confirmed: true }).status, 409);
  } finally { f.db.close(); }
});

test('Peerless Aim also converts a spell attack miss without spending another spell resource', () => {
  const f = fixture('Path of the World Tree', 19);
  try {
    f.stats.levelFeats = [{ name: 'Boon of Combat Prowess', level: 19 }]; f.db.prepare('UPDATE character_statistics SET data = ? WHERE character_id = 1').run(JSON.stringify(f.stats));
    const b = f.ok(f.start()).battle, targetId = b.fighters[1].id;
    f.mutate(b => { b.pending = { kind: 'spell', castingId: 'beam-test', actorId: b.fighters[0].id, spellId: 'fire-bolt', spellName: 'Test', attackBonus: 5, spec: { mode: 'attack', dice: 1, sides: 10, type: 'Fire', bonus: 0 }, stage: 'attack', targets: [{ id: targetId }] }; });
    f.ok(f.act('spell-attack', { roll: 1 })); f.ok(f.act('epic-prowess'));
    f.ok(f.act('spell-defense', { targetId, multiplier: 1 }, f.gm)); f.ok(f.act('spell-effect', { rolls: [5] }));
    assert.equal(f.call().battle.fighters[1].hp, 95);
  } finally { f.db.close(); }
});

test('Night Spirit grants lighting-dependent resistance and invisibility; Blink Steps waits for a completed action', () => {
  const f = fixture('Path of the World Tree', 19);
  try {
    f.stats.levelFeats = [{ name: 'Boon of the Night Spirit', level: 19 }, { name: 'Boon of Dimensional Travel', level: 19 }]; f.db.prepare('UPDATE character_statistics SET data = ? WHERE character_id = 1').run(JSON.stringify(f.stats));
    f.ok(f.start()); f.ok(f.act('epic-light', { dim: true, confirmed: true })); f.ok(f.act('epic-shadows'));
    assert.ok(f.call().battle.fighters[0].conditionSources.some(e => e.kind === 'invisible'));
    assert.equal(f.act('epic-blink', { confirmed: true }).status, 409);
    f.ok(f.hit({ roll: 15, roll2: 15 })); f.ok(f.act('damage', { rolls: [3] }));
    assert.equal(f.act('epic-blink', { confirmed: true }).status, 409);
    f.ok(f.hit({ roll: 15, roll2: 15 })); f.ok(f.act('damage', { rolls: [3] }));
    assert.equal(f.call().battle.fighters[0].conditionSources.some(e => e.kind === 'invisible'), false);
    f.ok(f.act('epic-blink', { confirmed: true })); assert.equal(f.act('epic-blink', { confirmed: true }).status, 409);
  } finally { f.db.close(); }
});

test('Successful Relentless Rage prevents the zero-HP ending of Rage of the Gods', () => {
  const f = fixture('Path of the Zealot', 14);
  try {
    f.ok(f.start()); f.ok(f.act('rage', { divineForm: true }));
    f.mutate(b => { b.fighters[0].hp = 0; b.fighters[0].relentlessRagePending = { dc: 10 }; });
    f.ok(f.act('relentless-rage', { roll: 20 }));
    assert.equal(f.call().battle.fighters[0].hp, 28); assert.ok(f.call().battle.fighters[0].divineForm);
    f.mutate(b => { b.fighters[0].hp = 0; b.fighters[0].relentlessRagePending = { dc: 15 }; });
    f.ok(f.act('relentless-rage', { decline: true }));
    assert.equal(f.call().battle.fighters[0].divineForm, null);
  } finally { f.db.close(); }
});
