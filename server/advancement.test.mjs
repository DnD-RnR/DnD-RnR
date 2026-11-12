import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from './db.mjs';
import { handleAdvancement } from './advancement.mjs';
import { emptyStatistics, handleStatistics } from './statistics.mjs';
import { characterTraits } from '../shared/character-traits.mjs';
import { advancementPreview } from '../shared/advancement.mjs';
import { exportRows, hydrate } from './firestore.mjs';
import options from '../shared/character-options.json' with { type: 'json' };
import { spellcastingProfile } from '../shared/spellcasting.mjs';
import { weaponMasteryCount, weapons } from '../shared/weapon-mastery.mjs';
import { fightingStyleCount } from '../shared/fighting-style.mjs';

const gm = { id: 1, name: 'GM', role: 'gm' }, player = { id: 2, name: 'Player', role: 'player' };
function fixture(level = 1, species = 'Ork (Orc)') {
  const db = openDatabase();
  db.exec(`INSERT INTO users VALUES (1,'gm','GM','unused','gm'),(2,'player','Player','unused','player'),(3,'other','Other','unused','gm');
    INSERT INTO games (id,gm_id,name) VALUES (1,1,'Milestones');
    INSERT INTO characters (id,user_id,name,class,level,species,background,subclass)
      VALUES (1,2,'Hero','Wojownik (Fighter)',${level},'${species}','Żołnierz (Soldier)','${level >= 3 ? 'Champion' : ''}');
    INSERT INTO game_members VALUES (1,1,1,'accepted');`);
  const stats = emptyStatistics();
  Object.assign(stats.values, { str: 16, dex: 12, con: 15, int: 10, wis: 12, cha: 8, hp: 7, maxHp: 12, hitDice: 0 });
  stats.choices = { weaponMastery: ['longsword','shortsword','longbow'], fightingStyle: 'defense', fastCrafting: '' };
  const character = db.prepare('SELECT * FROM characters WHERE id=1').get();
  for (let i = 0; i < 4; i++) for (const group of characterTraits(character, stats).groups) stats.traits[group.id] ??= group.options.slice(0, group.limit).map(o => o.id);
  db.prepare('INSERT INTO character_statistics VALUES (1,?)').run(JSON.stringify(stats));
  db.prepare('INSERT INTO character_spell_resources VALUES (1,?)').run(JSON.stringify({ slots: { 1: 2 }, fighterSecondWindSpent: 1 }));
  return db;
}
function request(db, user, path, method = 'GET', body = {}) {
  let response;
  assert.equal(handleAdvancement(db, user, `/api${path}`, method, body, (status, data) => { response = { status, ...data }; }), true);
  return response;
}
const get = db => request(db, player, '/characters/1/advancement');
const grant = db => request(db, gm, '/games/1/advancements', 'POST', { characterIds: [1], reason: 'Saved the village' });
const submit = (db, action, data, draft) => request(db, player, `/characters/1/advancement/${action}`, 'POST', { id: data.pending.id, version: data.pending.version, base: data.base, draft });

test('GM awards one pending milestone; unauthorized or duplicate grants cannot change levels', () => {
  const db = fixture();
  try {
    assert.equal(request(db, player, '/games/1/advancements', 'POST', {}).status, 404);
    assert.equal(request(db, { ...gm, id: 3 }, '/games/1/advancements').status, 404);
    assert.equal(grant(db).status, 201);
    assert.equal(grant(db).status, 409);
    assert.equal(get(db).character.level, 1);
    assert.equal(get(db).pending.toLevel, 2);
    assert.equal(request(db, gm, '/characters/1/advancement').status, 404);
  } finally { db.close(); }
});

test('draft survives reopening, completion is atomic, preserves spent resources, and cannot be replayed', () => {
  let db = fixture();
  try {
    grant(db); const data = get(db);
    assert.equal(submit(db, 'draft', data, { hpMode: 'roll', hpRoll: 8 }).status, 200);
    assert.equal(submit(db, 'draft', data, {}).status, 409);
    const rows = exportRows(db); db.close(); db = hydrate(rows);
    const restored = get(db);
    assert.equal(restored.pending.draft.hpRoll, 8);
    const resource = db.prepare('SELECT data FROM character_spell_resources WHERE character_id=1').get().data;
    const result = submit(db, 'complete', restored, restored.pending.draft);
    assert.equal(result.status, 200, result.error);
    assert.equal(result.character.level, 2);
    const after = get(db);
    assert.equal(after.statistics.values.maxHp, 22);
    assert.equal(after.statistics.values.hp, 7);
    assert.equal(after.statistics.values.hitDice, 0);
    assert.equal(db.prepare('SELECT data FROM character_spell_resources WHERE character_id=1').get().data, resource);
    assert.equal(after.pending, null);
    assert.equal(after.history[0].status, 'completed');
    assert.equal(submit(db, 'complete', restored, restored.pending.draft).status, 409);
  } finally { db.close(); }
});

test('invalid rolls, forged selections and missing subclass leave the original card intact', () => {
  const db = fixture(2);
  try {
    grant(db); const data = get(db);
    for (const draft of [{ hpMode: 'roll', hpRoll: 11 }, {}, { subclass: 'Fake' }, { subclass: 'Champion', choices: { weaponMastery: null } }, { subclass: 'Champion', traits: { forged: ['anything'] } }]) {
      assert.equal(submit(db, 'complete', data, draft).status, 400);
      assert.equal(get(db).character.level, 2);
    }
    assert.equal(submit(db, 'complete', data, { subclass: 'Champion' }).status, 200);
  } finally { db.close(); }
});

test('active battle blocks completion and undo but permits draft saving and milestone grant', () => {
  const db = fixture();
  try {
    db.exec('INSERT INTO game_sessions VALUES (1,1,1,NULL)');
    db.prepare('INSERT INTO session_battles VALUES (1,?)').run(JSON.stringify({ active: true }));
    assert.equal(grant(db).status, 201);
    const data = get(db); assert.equal(data.blockedByBattle, true);
    assert.equal(submit(db, 'complete', data, {}).status, 409);
    assert.equal(submit(db, 'draft', data, {}).status, 200);
  } finally { db.close(); }
});

test('stale card and removed membership block completion; no owner can approve someone else’s award', () => {
  const db = fixture();
  try {
    grant(db); const data = get(db);
    db.prepare('UPDATE character_statistics SET data=json_set(data,\'$.values.hp\',6) WHERE character_id=1').run();
    assert.equal(submit(db, 'complete', data, {}).status, 409);
    const current = get(db);
    db.exec("UPDATE game_members SET status='declined'");
    assert.equal(submit(db, 'complete', current, {}).status, 409);
    assert.equal(get(db).character.level, 1);
  } finally { db.close(); }
});

test('ability increase accounts for Constitution retroactively, dwarf bonus and new level', () => {
  const db = fixture(3, 'Krasnolud (Dwarf)');
  try {
    grant(db); const data = get(db);
    assert.equal(submit(db, 'complete', data, { increases: { con: 3 } }).status, 400);
    const completed = submit(db, 'complete', data, { increases: { con: 1, str: 1 }, choices: { ...data.statistics.choices, weaponMastery: [...data.statistics.choices.weaponMastery, 'dagger'] } });
    assert.equal(completed.status, 200, completed.error);
    // Fixed 6 + old CON 2 + retroactive 4 * 1 + Dwarven Toughness 1.
    assert.equal(get(db).statistics.values.maxHp, 25);
    assert.equal(get(db).statistics.values.con, 16);
    assert.equal(get(db).statistics.values.hp, 7);
  } finally { db.close(); }
});

test('Tough adds HP for all levels and survives normal statistics edits without accepting forged feats', () => {
  const db = fixture(3);
  try {
    grant(db); const data = get(db);
    const result = submit(db, 'complete', data, { featMode: 'feat', feat: 'Tough', choices: { ...data.statistics.choices, weaponMastery: [...data.statistics.choices.weaponMastery, 'dagger'] } });
    assert.equal(result.status, 200, result.error);
    const current = get(db);
    assert.equal(current.statistics.values.maxHp, 28); // fixed 6 + CON 2 + Tough 8
    assert.ok(characterTraits(current.character, current.statistics).feats.includes('Tough'));
    const body = { ...current.statistics, levelFeats: [{ level: 1, name: 'Alert' }] };
    let response;
    handleStatistics(db, player, '/api/characters/1/statistics', 'POST', body, (status, data) => { response = { status, ...data }; });
    assert.equal(response.status, 200, response.error);
    assert.deepEqual(get(db).statistics.levelFeats, [{ level: 4, name: 'Tough' }]);
  } finally { db.close(); }
});

test('GM can safely undo the latest advancement and cancel pending awards', () => {
  const db = fixture();
  try {
    grant(db); const data = get(db);
    assert.equal(submit(db, 'complete', data, {}).status, 200);
    assert.equal(request(db, gm, `/games/1/advancements/${data.pending.id}/undo`, 'POST').status, 200);
    assert.equal(get(db).character.level, 1);
    assert.equal(get(db).statistics.values.maxHp, 12);
    assert.equal(get(db).history[0].status, 'reverted');
    grant(db); const id = get(db).pending.id;
    assert.equal(request(db, gm, `/games/1/advancements/${id}/cancel`, 'POST').status, 200);
    assert.equal(get(db).pending, null);
  } finally { db.close(); }
});

test('undo refuses to overwrite later statistics or resource use', () => {
  for (const update of ["UPDATE character_statistics SET data=json_set(data,'$.values.hp',6)", "UPDATE character_spell_resources SET data=json_set(data,'$.fighterSecondWindSpent',2)"]) {
    const db = fixture();
    try {
      grant(db); const data = get(db); submit(db, 'complete', data, {});
      db.exec(update);
      assert.equal(request(db, gm, `/games/1/advancements/${data.pending.id}/undo`, 'POST').status, 409);
      assert.equal(get(db).character.level, 2);
    } finally { db.close(); }
  }
});

test('mixed party awards are all-or-nothing and level 20 cannot advance', () => {
  const db = fixture(20);
  try {
    assert.equal(grant(db).status, 409);
    assert.equal(request(db, gm, '/games/1/advancements', 'POST', { characterIds: [1, 999], reason: 'Milestone' }).status, 409);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM character_advancements').get().n, 0);
  } finally { db.close(); }
});

test('minimum HP roll, Tough per-level bonus and level-20 capstone are computed consistently', () => {
  const stats = emptyStatistics();
  stats.values = { maxHp: 100, con: 8, str: 20, hp: 1 };
  const character = { class: 'Barbarzyńca (Barbarian)', level: 19, species: 'Krasnolud (Dwarf)', background: 'Żołnierz (Soldier)', subclass: 'Path of the Berserker' };
  const preview = advancementPreview(character, stats, { hpMode: 'roll', hpRoll: 1 });
  assert.equal(preview.statistics.values.str, 24);
  assert.equal(preview.statistics.values.con, 12);
  assert.equal(preview.hpGain, 42); // minimum 1 + 20*2 CON + dwarf 1
});

function fillChoices(character, initial) {
  const stats = structuredClone(initial);
  stats.choices.weaponMastery = weapons.slice(0, weaponMasteryCount(character)).map(w => w.id);
  stats.choices.fightingStyle = fightingStyleCount(character) ? 'defense' : '';
  for (let attempt = 0; attempt < 5; attempt++) {
    let profile = spellcastingProfile(character, stats.spells, stats.traits);
    for (const choice of profile.choices) stats.spells.choices[choice.id] ??= choice.options.find(o => o.id)?.id ?? '';
    profile = spellcastingProfile(character, stats.spells, stats.traits);
    for (const group of profile.groups) {
      const selected = stats.spells.selections[group.id] ?? [];
      const valid = selected.filter(id => group.options.some(o => o.id === id));
      const available = group.options.filter(o => !valid.includes(o.id) && (!group.fromBook || stats.spells.selections.book?.includes(o.id)));
      const count = group.limit ?? 6 + 2 * (character.level - 1);
      stats.spells.selections[group.id] = [...valid, ...available.slice(0, Math.max(0, count - valid.length)).map(o => o.id)];
    }
    for (const group of characterTraits(character, stats).groups) {
      const selected = stats.traits[group.id] ?? [];
      const valid = selected.filter(id => group.options.some(o => o.id === id));
      stats.traits[group.id] = [...valid, ...group.options.filter(o => !valid.includes(o.id)).slice(0, Math.max(0, group.limit - valid.length)).map(o => o.id)];
    }
  }
  if (character.class === 'Paladyn (Paladin)' && stats.spells.choices.style === 'magic') stats.choices.fightingStyle = '';
  return stats;
}

test('every supported class can advance from level one with complete new spell and trait choices', () => {
  for (const cls of options.classes) {
    const db = fixture();
    try {
      db.prepare('UPDATE characters SET class=? WHERE id=1').run(cls.name);
      const character = db.prepare('SELECT * FROM characters WHERE id=1').get();
      const old = emptyStatistics(); Object.assign(old.values, { con: 14, maxHp: 12, hp: 4 });
      old.choices.fastCrafting = '';
      const stats = fillChoices(character, old);
      db.prepare('UPDATE character_statistics SET data=? WHERE character_id=1').run(JSON.stringify(stats));
      grant(db); const data = get(db);
      const nextStats = fillChoices({ ...character, level: 2 }, stats);
      const completed = submit(db, 'complete', data, { traits: nextStats.traits, spells: nextStats.spells, choices: nextStats.choices });
      assert.equal(completed.status, 200, `${cls.name}: ${completed.error}`);
      assert.equal(get(db).character.level, 2);
    } finally { db.close(); }
  }
});

test('every supported class can choose its first subclass and complete level three', () => {
  for (const cls of options.classes) {
    const db = fixture(2);
    try {
      db.prepare('UPDATE characters SET class=? WHERE id=1').run(cls.name);
      const character = db.prepare('SELECT * FROM characters WHERE id=1').get();
      const old = emptyStatistics(); Object.assign(old.values, { con: 14, maxHp: 20, hp: 4 }); old.choices.fastCrafting = '';
      const stats = fillChoices(character, old);
      db.prepare('UPDATE character_statistics SET data=? WHERE character_id=1').run(JSON.stringify(stats));
      grant(db); const data = get(db);
      const nextStats = fillChoices({ ...character, level: 3, subclass: cls.subclasses[0] }, stats);
      const completed = submit(db, 'complete', data, { subclass: cls.subclasses[0], traits: nextStats.traits, spells: nextStats.spells, choices: nextStats.choices });
      assert.equal(completed.status, 200, `${cls.name}: ${completed.error}`);
      assert.equal(get(db).character.subclass, cls.subclasses[0]);
    } finally { db.close(); }
  }
});
