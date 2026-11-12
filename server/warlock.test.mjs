import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pactMagicUpdate, invocationUpdate } from './warlock.mjs';
import { invocations, invocationCount, invocationOptions } from '../shared/warlock-invocations.mjs';
import { invocationDescriptions, invocationSheet } from '../shared/warlock-invocation-effects.mjs';
import { characterTraits, validateTraitSelection } from '../shared/character-traits.mjs';
import { handleStatistics, emptyStatistics } from './statistics.mjs';
import { openDatabase } from './db.mjs';
import progression from '../shared/spell-progression.json' with { type: 'json' };
import { fiendProfile } from '../shared/warlock.mjs';
import { spellcastingProfile } from '../shared/spellcasting.mjs';

test('Fiend level three has two second-level pact slots, three invocations and four additional prepared spells', () => {
  const character = { ...hero(3), subclass: 'Fiend Patron' };
  const p = spellcastingProfile(character);
  assert.equal(p.pactSlotLevel, 2);
  assert.deepEqual(p.slots, [2]);
  assert.equal(invocationCount(character), 3);
  assert.equal(p.groups.find(g => g.id === 'cantrips').limit, 2);
  assert.equal(p.groups.find(g => g.id === 'prepared').limit, 4);
  assert.deepEqual(p.automatic.map(s => s.id).sort(), ['burning-hands', 'command', 'scorching-ray', 'suggestion'].sort());
  assert.ok(characterTraits(character, emptyStatistics()).features.some(f => f.name === "Dark One's Blessing" && f.description));
  assert.equal(fiendProfile(character, 16).temporaryHitPoints, 6);
  assert.equal(fiendProfile(character, 2).temporaryHitPoints, 1);
  assert.equal(fiendProfile(character, null).temporaryHitPoints, null);
  assert.equal(fiendProfile({ ...character, level: 2 }, 16).enabled, false);
  assert.equal(fiendProfile({ ...character, class: 'Bard' }, 16).enabled, false);
});

test('Fiend advancement grants spells without using the ordinary replacement budget', () => {
  const first = pactMagicUpdate(hero(2), selection(undefined, ['hex', 'suggestion', 'witch-bolt']), null, {});
  const next = selection(undefined, ['hex', 'witch-bolt', 'darkness', 'invisibility']);
  const result = pactMagicUpdate({ ...hero(3), subclass: 'Fiend Patron' }, next, saved(first), {});
  assert.ok(result.history);
  assert.equal(result.history.preparedRemaining, 1);
});

const hero = level => ({ class: progression.warlock.name, level, subclass: '', species: '', background: '' });
const selection = (cantrips = ['eldritch-blast', 'prestidigitation'], prepared = ['hex', 'charm-person']) => ({ choices: {}, selections: { cantrips, prepared } });
const saved = result => ({ pactMagicProgression: result.history });

test('Pact Magic requires complete choices and locks the initial list at the same level', () => {
  assert.ok(pactMagicUpdate(hero(1), selection([], []), null, {}).error);
  const first = pactMagicUpdate(hero(1), selection(), null, {});
  assert.ok(first.history);
  assert.ok(pactMagicUpdate(hero(1), selection(['mage-hand', 'minor-illusion']), saved(first), {}).error);
  assert.deepEqual(pactMagicUpdate(hero(1), selection(), saved(first), {}).history, first.history);
});

test('each gained level grants separate replacement budgets that cannot be reused', () => {
  const first = saved(pactMagicUpdate(hero(1), selection(), null, {}));
  const next = selection(['mage-hand', 'prestidigitation'], ['hex', 'witch-bolt', 'hellish-rebuke']);
  const update = pactMagicUpdate(hero(2), next, first, {});
  assert.ok(update.history);
  assert.equal(update.history.cantripsRemaining, 0);
  assert.equal(update.history.preparedRemaining, 0);
  assert.ok(pactMagicUpdate(hero(2), selection(['minor-illusion', 'prestidigitation'], next.selections.prepared), saved(update), {}).error);
  assert.ok(pactMagicUpdate(hero(2), selection(next.selections.cantrips, ['hex', 'charm-person', 'hellish-rebuke']), saved(update), {}).error);
  assert.ok(pactMagicUpdate(hero(1), selection(), saved(update), {}).error);
  assert.ok(pactMagicUpdate(hero(2), selection(['mage-hand', 'minor-illusion'], next.selections.prepared), first, {}).error);
});

test('growth, skipped levels and repeated unrelated saves preserve replacement limits', () => {
  const first = saved(pactMagicUpdate(hero(1), selection(), null, {}));
  assert.deepEqual(pactMagicUpdate(hero(4), selection(), first, {}, false).history, first.pactMagicProgression);
  const update = pactMagicUpdate(hero(4), selection(['mage-hand', 'minor-illusion', 'friends'], ['hex', 'charm-person', 'witch-bolt', 'hellish-rebuke', 'invisibility']), first, {});
  assert.ok(update.history);
  assert.equal(update.history.cantripsRemaining, 1);
});

test('legacy partial choices can be completed but cannot be freely replaced', () => {
  const legacy = { spells: selection(['eldritch-blast'], ['hex']) };
  assert.ok(pactMagicUpdate(hero(1), selection(), legacy, {}).history);
  assert.ok(pactMagicUpdate(hero(1), selection(['mage-hand', 'minor-illusion']), legacy, {}).error);
  assert.equal(pactMagicUpdate(hero(1), legacy.spells, legacy, {}, false).history.level, 1);
  assert.deepEqual(pactMagicUpdate({ class: 'Bard', level: 1 }, selection(), legacy, {}), {});
});

test('new always-prepared patron spells leave the ordinary list without spending a replacement', () => {
  const first = saved(pactMagicUpdate(hero(3), selection(undefined, ['hex', 'charm-person', 'witch-bolt', 'misty-step']), null, {}));
  const update = pactMagicUpdate({ ...hero(4), subclass: 'Archfey Patron' }, selection(['eldritch-blast', 'prestidigitation', 'mage-hand'], ['hex', 'witch-bolt', 'hellish-rebuke', 'invisibility', 'darkness']), first, {});
  assert.ok(update.history);
  assert.equal(update.history.preparedRemaining, 0);
});

test('statistics endpoint persists server progression and rejects forged history without writing', () => {
  const db = openDatabase(':memory:');
  try {
    db.exec("INSERT INTO users VALUES (1,'player','Player','unused','player');");
    db.prepare("INSERT INTO characters (id,user_id,name,class,level) VALUES (1,1,'Warlock',?,1)").run(hero(1).class);
    const stats = emptyStatistics();
    stats.spells = selection();
    stats.traits = { languages: ['elvish', 'dwarvish'], classSkills: ['arcana', 'deception'], invocations: ['pact-of-the-blade'] };
    const call = body => {
      let result;
      handleStatistics(db, { id: 1 }, '/api/characters/1/statistics', 'POST', body, (status, data) => { result = { status, data }; });
      return result;
    };
    assert.equal(call(stats).status, 200);
    const stored = () => JSON.parse(db.prepare('SELECT data FROM character_statistics WHERE character_id = 1').get().data);
    const before = stored();
    assert.equal(before.pactMagicProgression.level, 1);
    stats.traits.invocations = ['pact-of-the-tome'];
    stats.invocationProgression = { level: 0, remaining: 99 };
    assert.equal(call(stats).status, 400);
    assert.deepEqual(stored(), before);
    stats.traits.invocations = ['pact-of-the-blade'];
    stats.spells = selection(['mage-hand', 'minor-illusion']);
    stats.pactMagicProgression = { level: 0, cantripsRemaining: 99 };
    assert.equal(call(stats).status, 400);
    assert.deepEqual(stored(), before);
    stats.spells = selection(undefined, ['hex', 'charm-person', 'witch-bolt']);
    db.prepare('UPDATE characters SET level = 2 WHERE id = 1').run();
    stats.traits.invocations.push('eldritch-mind', 'armor-of-shadows');
    assert.equal(call(stats).status, 200);
    assert.equal(stored().pactMagicProgression.level, 2);
    assert.equal(stored().invocationProgression.remaining, 1);
    stats.traits.invocations[0] = 'pact-of-the-tome';
    assert.equal(call(stats).status, 200);
    assert.equal(stored().invocationProgression.remaining, 0);
    stats.traits.invocations[0] = 'pact-of-the-chain';
    assert.equal(call(stats).status, 400);
    stats.traits.invocations[0] = 'pact-of-the-tome';
    stats.spells = selection(['mage-hand', 'prestidigitation'], stats.spells.selections.prepared);
    assert.equal(call(stats).status, 200);
    stats.spells = selection(['minor-illusion', 'prestidigitation'], stats.spells.selections.prepared);
    assert.equal(call(stats).status, 400);
  } finally { db.close(); }
});

const invocationStats = (selected, cantrips = ['eldritch-blast', 'prestidigitation']) => ({ traits: { invocations: selected }, spells: selection(cantrips) });
test('invocation progression matches all twenty levels and includes every catalog entry', () => {
  const counts = [1,3,3,3,5,5,6,6,7,7,7,8,8,8,9,9,9,10,10,10];
  counts.forEach((count, i) => assert.equal(invocationCount(hero(i + 1)), count));
  assert.equal(invocationCount({ class: 'Bard', level: 20 }), 0);
  assert.equal(invocations.length, 35);
  assert.equal(new Set(invocations.map(i => i.id)).size, 35);
  const start = invocationOptions(hero(1), invocationStats([])).map(i => i.id);
  assert.ok(start.includes('pact-of-the-tome'));
  assert.ok(!start.includes('devils-sight'));
});

test('invocations enforce levels, dependencies, unique targets and known eligible cantrips', () => {
  const validate = (level, ids, cantrips) => invocationUpdate(hero(level), invocationStats(ids, cantrips), null);
  assert.ok(validate(1, ['witch-sight']).error);
  assert.ok(validate(2, ['eldritch-mind', 'eldritch-mind', 'armor-of-shadows']).error);
  assert.ok(validate(2, ['eldritch-mind', 'armor-of-shadows', 'thirsting-blade']).error);
  assert.ok(validate(2, ['agonizing-blast:prestidigitation', 'eldritch-mind', 'armor-of-shadows']).error);
  assert.ok(validate(2, ['eldritch-spear:chill-touch', 'eldritch-mind', 'armor-of-shadows'], ['poison-spray']).error);
  assert.ok(validate(2, ['repelling-blast:mind-sliver', 'eldritch-mind', 'armor-of-shadows'], ['mind-sliver']).error);
  assert.ok(validate(2, ['agonizing-blast:eldritch-blast', 'agonizing-blast:poison-spray', 'lessons-of-the-first-ones:Tough'], ['eldritch-blast','poison-spray']).history);
  assert.ok(validate(2, ['lessons-of-the-first-ones:Tough', 'lessons-of-the-first-ones:Alert', 'eldritch-mind']).history);
  assert.ok(validate(2, ['agonizing-blast:eldritch-blast', 'eldritch-mind', 'armor-of-shadows'], ['poison-spray']).error);
});

test('invocation growth grants one exchange per gained level and records consumed exchanges', () => {
  const first = invocationUpdate(hero(1), invocationStats(['pact-of-the-blade']), null);
  const stored = { invocationProgression: first.history };
  assert.ok(invocationUpdate(hero(1), invocationStats(['pact-of-the-tome']), stored).error);
  const ids = ['pact-of-the-tome', 'eldritch-mind', 'armor-of-shadows'];
  const next = invocationUpdate(hero(2), invocationStats(ids), stored);
  assert.equal(next.history.remaining, 0);
  assert.ok(invocationUpdate(hero(2), invocationStats(['pact-of-the-chain', ...ids.slice(1)]), { invocationProgression: next.history }).error);
  assert.deepEqual(invocationUpdate(hero(3), invocationStats(ids), { invocationProgression: next.history }, false).history, next.history);
  assert.ok(invocationUpdate(hero(1), invocationStats(['pact-of-the-tome']), { invocationProgression: next.history }).error);
});

test('retained dependent invocations prevent replacing their prerequisites', () => {
  const ids = ['pact-of-the-blade', 'thirsting-blade', 'eldritch-mind', 'armor-of-shadows', 'devils-sight'];
  const before = invocationUpdate(hero(5), invocationStats(ids), null);
  assert.ok(before.history);
  assert.ok(invocationUpdate(hero(6), invocationStats(['pact-of-the-tome', ...ids.slice(1)]), { invocationProgression: before.history }).error);
  const replaced = invocationUpdate(hero(6), invocationStats([ids[0], 'eldritch-smite', ...ids.slice(2)]), { invocationProgression: before.history });
  assert.ok(replaced.history);
});

test('every invocation has a static sheet entry and every granted spell exists', () => {
  const choices = invocations.map(i => i.target ? `${i.id}:${i.target === 'feat' ? 'Tough' : 'eldritch-blast'}` : i.id);
  const sheet = invocationSheet(hero(20), { ...invocationStats(choices), values: { cha: 18 } });
  assert.equal(sheet.length, 35);
  for (const i of invocations) assert.ok(invocationDescriptions[i.id]?.length > 20, i.id);
  assert.equal(sheet.find(i => i.id === 'armor-of-shadows').spells[0].id, 'mage-armor');
  assert.match(sheet.find(i => i.id === 'eldritch-spear:eldritch-blast').details.join(), /600/);
  assert.match(sheet.find(i => i.id === 'agonizing-blast:eldritch-blast').details.join(), /\+4/);
  assert.match(sheet.find(i => i.id === 'eldritch-smite').details.join(), /6k8/);
  for (const i of sheet) for (const spell of i.spells) assert.ok(spell.url && spell.name);
  assert.deepEqual(invocationSheet({ class: 'Bard', level: 20 }, invocationStats(choices)), []);
});

test('static senses, concentration advantage and origin feats update the character sheet', () => {
  const stats = emptyStatistics();
  stats.values.cha = 18;
  stats.values.speed = 25;
  stats.traits = { invocations: ['eldritch-mind', 'devils-sight', 'witch-sight', 'gift-of-the-depths', 'lessons-of-the-first-ones:Tough', 'lessons-of-the-first-ones:Alert', 'lessons-of-the-first-ones:Skilled', 'lessons-of-the-first-ones:Crafter'] };
  const p = characterTraits(hero(20), stats);
  assert.equal(p.hpBonus, 40);
  assert.equal(p.initiativeBonus, 6);
  assert.equal(p.swimSpeed, 25);
  assert.ok(p.senses.some(s => s.includes('120')));
  assert.ok(p.senses.some(s => s.includes('Truesight')));
  assert.ok(p.defenses.some(s => s.includes('Eldritch Mind')));
  assert.equal(p.groups.find(g => g.id === 'skilled').limit, 3);
  assert.equal(p.groups.find(g => g.id === 'crafter').limit, 3);
  stats.traits = {};
  const removed = characterTraits(hero(20), stats);
  assert.equal(removed.hpBonus, 0);
  assert.equal(removed.swimSpeed, null);
  assert.equal(removed.invocationEntries.length, 0);
});

test('Tome choices exclude prepared spells, accept any class and enable targeted invocations', () => {
  const stats = emptyStatistics();
  stats.spells = selection();
  stats.traits = { invocations: ['pact-of-the-tome'], tomeCantrips: ['fire-bolt', 'light', 'guidance'], tomeRituals: ['alarm', 'identify'] };
  const p = characterTraits(hero(5), stats);
  assert.equal(validateTraitSelection(hero(5), stats), null);
  assert.equal(p.invocationEntries[0].spells.length, 5);
  assert.ok(!p.groups.find(g => g.id === 'tomeCantrips').options.some(s => s.id === 'eldritch-blast'));
  assert.ok(!p.groups.find(g => g.id === 'tomeRituals').options.some(s => s.id === 'hex'));
  assert.ok(invocationOptions(hero(5), stats).some(i => i.id === 'agonizing-blast:fire-bolt'));
  assert.ok(invocationOptions(hero(5), stats).some(i => i.id === 'repelling-blast:fire-bolt'));
  stats.traits.tomeRituals = ['hex'];
  assert.ok(validateTraitSelection(hero(5), stats));
});


// Levels 1–10: persistent resources and the same authorized combat routes as the UI.
import { warlockProfile, bondAdvantage, hexDisadvantage } from '../shared/warlock.mjs';
import { handleBattles } from './battles.mjs';
import { publicCaster, resourceState, saveResources, handleSpellResources } from './spell-resources.mjs';
import { restWarlock, useWarlockFeature } from './warlock-features.mjs';

function patronSetup(subclass = 'Great Old One Patron', level = 10) {
  const db = openDatabase(':memory:');
  db.exec(`INSERT INTO users VALUES (1,'gm','GM','unused','gm'),(2,'warlock','Warlock','unused','player'),(3,'ally','Ally','unused','player');
    INSERT INTO games (id,gm_id,name) VALUES (1,1,'Patrons');
    INSERT INTO game_sessions (id,game_id,started_at) VALUES (1,1,1);
    INSERT INTO characters (id,user_id,name,class,level) VALUES (1,2,'Warlock','Bard',3),(2,3,'Ally','Bard',1);
    INSERT INTO game_members (id,game_id,character_id,status) VALUES (1,1,1,'accepted'),(2,1,2,'accepted');
    INSERT INTO session_participants VALUES (1,1,1),(1,2,1);
    INSERT INTO game_monster_entries VALUES (1,'enemy','Enemy',100,14,30,'','{"str":1,"dex":1,"con":1,"int":1,"wis":1,"cha":1}');`);
  db.prepare('UPDATE characters SET class = ?, subclass = ?, level = ? WHERE id = 1').run(hero(level).class, subclass, level);
  const stats = emptyStatistics();
  Object.assign(stats.values, { str: 10, dex: 12, con: 14, int: 16, wis: 16, cha: 16, hp: 40, maxHp: 40, tempHp: 0, ac: 12, speed: 30 });
  stats.spells.selections = { cantrips: ['poison-spray', 'toll-the-dead'], prepared: ['hellish-rebuke', ...(level < 10 || subclass !== 'Great Old One Patron' ? ['hex'] : [])] };
  db.prepare('INSERT INTO character_statistics VALUES (1, ?)').run(JSON.stringify(stats));
  db.prepare('INSERT INTO character_statistics VALUES (2, ?)').run(JSON.stringify({ ...stats, spells: emptyStatistics().spells }));
  const gm = { id: 1, role: 'gm' }, player = { id: 2, role: 'player' }, ally = { id: 3, role: 'player' };
  let version = 0;
  const call = (action = '', body = {}, user = player) => {
    let result;
    handleBattles(db, user, `/api/games/1/battle${action ? '/' + action : ''}`, action ? 'POST' : 'GET', { sessionId: 1, version, ...body }, (status, data) => { result = { status, ...data }; });
    if (result.battle) version = result.battle.version;
    return result;
  };
  const start = () => call('start', { fighters: [{ memberId: 1, initiative: 20 }, { enemyId: 'enemy', initiative: 10 }, { memberId: 2, initiative: 5 }] }, gm);
  const own = (body = {}, user = player) => {
    let result;
    handleSpellResources(db, user, '/api/characters/1/spell-resources', 'POST', { version: resourceState(db, 1).version, ...body }, (status, data) => { result = { status, ...data }; });
    return result;
  };
  return { db, gm, player, ally, call, start, own };
}

test('both patrons match every progression threshold through ten and grant spells outside the ordinary budget', () => {
  const prepared = [2,3,4,5,6,7,8,9,10,10], slots = [1,1,2,2,3,3,4,4,5,5];
  for (const subclass of ['Fiend Patron', 'Great Old One Patron']) for (let level = 1; level <= 10; level++) {
    const c = { ...hero(level), subclass };
    const p = spellcastingProfile(c), w = warlockProfile(c, 16);
    assert.equal(p.groups.find(g => g.id === 'prepared').limit, prepared[level-1]);
    assert.equal(p.pactSlotLevel, slots[level-1]);
    assert.equal(p.groups.find(g => g.id === 'cantrips').limit, level >= 10 ? 4 : level >= 4 ? 3 : 2);
    assert.equal(invocationCount(c), [1,3,3,3,5,5,6,6,7,7][level-1]);
    assert.equal(w.luckMax, subclass === 'Fiend Patron' && level >= 6 ? 3 : 0);
    assert.equal(w.thoughtShield, subclass === 'Great Old One Patron' && level >= 10);
    assert.equal(w.resilience, subclass === 'Fiend Patron' && level >= 10);
    assert.equal(p.automatic.some(s => s.id === 'contact-other-plane'), level >= 9);
    if (subclass === 'Great Old One Patron') assert.equal(p.automatic.some(s => s.id === 'hex'), level >= 10);
    for (const spell of p.automatic) assert.ok(!p.groups.find(g => g.id === 'prepared').options.some(s => s.id === spell.id));
  }
  assert.equal(warlockProfile({ ...hero(10), subclass: 'Fiend Patron' }, 2).luckMax, 1);
  assert.equal(warlockProfile({ ...hero(10), subclass: 'Great Old One Patron' }, null).telepathyMiles, null);
});

test('outside combat features enforce ownership, optimistic versions, resource limits and rest choices', () => {
  const { db, own, ally, start } = patronSetup('Fiend Patron');
  try {
    const state = resourceState(db, 1); state.pactSpent = 2; saveResources(db, 1, state);
    assert.equal(own({ kind: 'magical-cunning' }, ally).status, 404);
    assert.equal(own({ kind: 'magical-cunning', version: -1 }).status, 409);
    assert.equal(own({ kind: 'magical-cunning' }).status, 200);
    assert.equal(resourceState(db, 1).pactSpent, 1);
    assert.equal(own({ kind: 'magical-cunning' }).status, 409);
    assert.equal(own({ kind: 'contact-patron', confirmed: true }).contactPatron.automaticSaveSuccess, true);
    assert.equal(own({ kind: 'contact-patron', confirmed: true }).status, 409);
    assert.equal(own({ kind: 'fiendish-resilience', damageType: 'moc' }).status, 409);
    assert.equal(own({ kind: 'fiendish-resilience', damageType: 'ogień' }).status, 200);
    assert.equal(own({ kind: 'fiendish-resilience', damageType: 'zimno' }).status, 409);
    assert.equal(own({ kind: 'dark-ones-own-luck', rollId: 'wis-1', luckRoll: 10 }).status, 200);
    assert.equal(own({ kind: 'dark-ones-own-luck', rollId: 'wis-1', luckRoll: 10 }).status, 409);
    let s = resourceState(db, 1); restWarlock(s, 'short'); saveResources(db, 1, s);
    assert.equal(own({ kind: 'fiendish-resilience', damageType: 'zimno' }).status, 200);
    assert.equal(publicCaster(db, 1).warlock.luckRemaining, 2);
    assert.equal(publicCaster(db, 1).warlock.cunningAvailable, false);
    s = resourceState(db, 1); restWarlock(s, 'long'); saveResources(db, 1, s);
    assert.equal(publicCaster(db, 1).warlock.luckRemaining, 3);
    assert.equal(publicCaster(db, 1).warlock.cunningAvailable, true);
    start(); assert.equal(own({ kind: 'contact-patron', confirmed: true }).status, 409);
  } finally { db.close(); }
});

test('Clairvoyant Combatant requires a real authorized save, forces attack dice, renews with a pact slot and expires', () => {
  const { db, call, start, gm, ally } = patronSetup('Great Old One Patron', 6);
  try {
    const b = start().battle, actor = b.fighters[0].id, target = b.fighters[1].id;
    const request = { kind: 'awakened-mind', actorId: actor, targetId: target, combatant: true, confirmed: true };
    assert.equal(call('act', request, ally).status, 409);
    assert.equal(call('act', request).status, 200);
    assert.equal(publicCaster(db, 1).warlock.clairvoyantAvailable, false);
    assert.equal(call('act', { kind: 'resolve', note: 'skip' }, gm).status, 409);
    assert.equal(call('act', { kind: 'clairvoyant-save', roll: 1 }).status, 409);
    const failed = call('act', { kind: 'clairvoyant-save', roll: 1 }, gm);
    assert.equal(failed.status, 200);
    assert.equal(bondAdvantage(failed.battle.fighters[0], failed.battle.fighters[1]), true);
    assert.equal(call('act', { kind: 'attack', attackId: 'unarmed', targetId: target, slot: 'action', roll: 2 }).status, 409);
    assert.equal(call('act', { kind: 'attack', attackId: 'unarmed', targetId: target, slot: 'action', roll: 1, roll2: 2 }).status, 200);
    assert.equal(call('act', { kind: 'clairvoyant-recover', actorId: actor }).status, 200);
    assert.equal(resourceState(db, 1).pactSpent, 1);
    assert.equal(call('act', { kind: 'clairvoyant-recover', actorId: actor }).status, 409);
    const f = failed.battle.fighters[0]; f.warlockBond.expiresAt = Date.now() - 1;
    assert.equal(bondAdvantage(f, failed.battle.fighters[1]), false);
  } finally { db.close(); }
});

test('Fiend luck improves checks and concentration once per roll and rejects invalid dice', () => {
  const { db, call, start, gm } = patronSetup('Fiend Patron', 6);
  try {
    const b = start().battle, actorId = b.fighters[0].id;
    assert.equal(call('act', { kind: 'ability-check', actorId, ability: 'wis', roll: 2, luckRoll: 11 }).status, 409);
    assert.equal(publicCaster(db, 1).warlock.luckRemaining, 3);
    assert.equal(call('act', { kind: 'ability-check', actorId, ability: 'wis', roll: 2, luckRoll: 8 }).status, 200);
    assert.equal(publicCaster(db, 1).warlock.luckRemaining, 2);
    // Put the caster into concentration using a real spell, then resolve incoming damage.
    assert.equal(call('act', { kind: 'cast', actorId, slot: 'bonus', spellId: 'hex', source: 'pact', level: 3, targetIds: [b.fighters[1].id], hexAbility: 'wis' }).status, 200);
    assert.equal(call('act', { kind: 'resolve', note: 'hit', targetId: actorId, effect: 'damage', amount: 1 }, gm).status, 200);
    const saved = call('act', { kind: 'concentration', actorId, roll: 1, luckRoll: 10 });
    assert.equal(saved.status, 200); assert.equal(saved.battle.fighters[0].concentration, 'Hex');
    assert.equal(call('act', { kind: 'concentration', actorId, roll: 1, luckRoll: 10 }).status, 409);
    assert.equal(publicCaster(db, 1).warlock.luckRemaining, 1);
  } finally { db.close(); }
});

test('Eldritch Hex applies saving throw disadvantage, critical bonus dice and ends with concentration', () => {
  const { db, call, start, gm } = patronSetup();
  try {
    const b = start().battle, actorId = b.fighters[0].id, targetId = b.fighters[1].id;
    const hex = call('act', { kind: 'cast', actorId, slot: 'bonus', spellId: 'hex', source: 'pact', level: 5, targetIds: [targetId], hexAbility: 'wis' });
    assert.equal(hex.status, 200);
    assert.equal(hexDisadvantage(hex.battle, hex.battle.fighters[1], 'wis'), true);
    assert.equal(call('act', { kind: 'cast', slot: 'action', spellId: 'poison-spray', source: 'cantrip', level: 0, targetIds: [targetId] }).status, 200);
    const hit = call('act', { kind: 'spell-attack', roll: 20 });
    assert.equal(hit.status, 200); assert.equal(hit.battle.pending.hexDice, 2);
    assert.equal(call('act', { kind: 'spell-defense', targetId, multiplier: 1 }, gm).status, 200);
    assert.equal(call('act', { kind: 'spell-effect', rolls: [1,1,1,1], hexRolls: [6] }).status, 409);
    const applied = call('act', { kind: 'spell-effect', rolls: [1,1,1,1], hexRolls: [6,6] });
    assert.equal(applied.status, 200);
    assert.equal(applied.battle.fighters[1].damageTaken, 16);
    assert.equal(call('act', { kind: 'resolve', note: 'hit', targetId: actorId, effect: 'damage', amount: 1 }, gm).status, 200);
    const lost = call('act', { kind: 'concentration', actorId, roll: 1 });
    assert.equal(lost.status, 200); assert.equal(hexDisadvantage(lost.battle, lost.battle.fighters[1], 'wis'), false);
  } finally { db.close(); }
});

test('Psychic Spells changes automated damage while Thought Shield and Fiend resistance mitigate once', () => {
  const { db, call, start, gm } = patronSetup();
  try {
    const b = start().battle, actorId = b.fighters[0].id, targetId = b.fighters[1].id;
    const cast = call('act', { kind: 'cast', slot: 'action', spellId: 'poison-spray', source: 'cantrip', level: 0, targetIds: [targetId], psychic: true });
    assert.equal(cast.status, 200); assert.equal(cast.battle.pending.spec.type, 'Psychic');
    assert.equal(call('act', { kind: 'spell-attack', roll: 19 }).status, 200);
    assert.equal(call('act', { kind: 'spell-defense', targetId, multiplier: 1 }, gm).status, 200);
    assert.equal(call('act', { kind: 'spell-effect', rolls: [2,2] }).status, 200);
    const reflect = call('act', { kind: 'resolve', note: 'psychic hit', targetId: actorId, sourceId: targetId, effect: 'damage', damageType: 'psychiczne', amount: 11 }, gm);
    assert.equal(reflect.status, 200); assert.equal(reflect.battle.fighters[0].hp, 35);
    assert.equal(reflect.battle.fighters[1].damageTaken, 9);
  } finally { db.close(); }
});


test('Fiendish Resilience halves automated spells once and luck changes a real spell save', () => {
  const { db, own, call, start, gm } = patronSetup('Fiend Patron');
  try {
    assert.equal(own({ kind: 'fiendish-resilience', damageType: 'ogień' }).status, 200);
    const b = start().battle, actorId = b.fighters[0].id;
    assert.equal(call('act', { kind: 'cast', spellId: 'fireball', slot: 'action', source: 'pact', level: 5, targetIds: [actorId] }).status, 200);
    const save = call('act', { kind: 'spell-save', targetId: actorId, roll: 7, luckRoll: 10 });
    assert.equal(save.status, 200); assert.equal(save.battle.pending.targets[0].saved, true);
    assert.equal(publicCaster(db, 1).warlock.luckRemaining, 2);
    assert.equal(call('act', { kind: 'spell-save', targetId: actorId, roll: 7, luckRoll: 10 }).status, 409);
    assert.equal(publicCaster(db, 1).warlock.luckRemaining, 2);
    assert.equal(call('act', { kind: 'spell-defense', targetId: actorId, multiplier: 1 }, gm).status, 200);
    const result = call('act', { kind: 'spell-effect', rolls: Array(10).fill(2) });
    assert.equal(result.status, 200); assert.equal(result.battle.fighters[0].hp, 35); // 20, save halves to 10, resistance halves to 5.
  } finally { db.close(); }
});

test('a successful Clairvoyant save gives no advantage, an existing bond gives incoming disadvantage', () => {
  for (const roll of [1, 20]) {
    const { db, call, start, gm } = patronSetup('Great Old One Patron', 6);
    try {
      const b = start().battle, actorId = b.fighters[0].id, targetId = b.fighters[1].id;
      assert.equal(call('act', { kind: 'awakened-mind', actorId, targetId, confirmed: true, combatant: true }).status, 200);
      const save = call('act', { kind: 'clairvoyant-save', roll }, gm);
      assert.equal(save.status, 200); assert.equal(bondAdvantage(save.battle.fighters[0], save.battle.fighters[1]), roll === 1);
      assert.equal(call('next', {}, gm).status, 200);
      const attack = { kind: 'attack', slot: 'action', targetId: actorId, attack: { name: 'Claw', bonus: 1, dice: 1, sides: 6, damageBonus: 0, type: 'cięte' }, roll: 2 };
      assert.equal(call('act', attack, gm).status, roll === 1 ? 409 : 200);
      if (roll === 1) assert.equal(call('act', { ...attack, roll2: 3 }, gm).status, 200);
    } finally { db.close(); }
  }
});

test('Hex transfers only after defeat on a later turn, persists its expiry and preserves its selected ability', () => {
  const { db, call, start, gm } = patronSetup();
  try {
    const b = start().battle, actorId = b.fighters[0].id, targetId = b.fighters[1].id, nextId = b.fighters[2].id;
    const cast = call('act', { kind: 'cast', slot: 'bonus', spellId: 'hex', source: 'pact', level: 5, targetIds: [targetId], hexAbility: 'con' });
    assert.equal(cast.status, 200);
    const expiresAt = cast.battle.fighters[0].hex.expiresAt;
    assert.equal(call('act', { kind: 'hex-transfer', actorId, targetId: nextId, confirmed: true }).status, 409);
    assert.equal(call('act', { kind: 'resolve', note: 'defeat', targetId, effect: 'damage', amount: 100 }, gm).status, 200);
    assert.equal(resourceState(db, 1).hex.targetDefeated, true);
    assert.equal(call('next', {}, gm).status, 200); assert.equal(call('next', {}, gm).status, 200);
    const transfer = call('act', { kind: 'hex-transfer', actorId, targetId: nextId, confirmed: true });
    assert.equal(transfer.status, 200); assert.equal(transfer.battle.fighters[0].hex.ability, 'con');
    assert.equal(transfer.battle.fighters[0].hex.expiresAt, expiresAt);
    assert.equal(resourceState(db, 1).hex.targetId, nextId);
  } finally { db.close(); }
});

test('short and long rest endpoints refresh only the matching Warlock resources', () => {
  const { db, gm } = patronSetup('Fiend Patron');
  try {
    const state = resourceState(db, 1);
    Object.assign(state, { magicalCunningUsed: true, contactPatronUsed: true, darkLuckSpent: 3, clairvoyantUsed: true, pactSpent: 2, fiendResistance: 'zimno', fiendResilienceChosenAt: 0 });
    saveResources(db, 1, state);
    const rest = type => {
      let result;
      handleSpellResources(db, gm, '/api/games/1/spell-rest', 'POST', { rest: type }, (status, data) => { result = { status, ...data }; });
      return result;
    };
    assert.equal(rest('short').status, 200);
    let p = publicCaster(db, 1).warlock;
    assert.equal(p.cunningAvailable, false); assert.equal(p.contactPatronAvailable, false); assert.equal(p.luckRemaining, 0);
    assert.equal(p.resistance, 'zimno'); assert.equal(p.resilienceChoiceAvailable, true);
    assert.equal(resourceState(db, 1).pactSpent, 0); assert.equal(resourceState(db, 1).clairvoyantUsed, false);
    assert.equal(rest('long').status, 200);
    p = publicCaster(db, 1).warlock;
    assert.equal(p.cunningAvailable, true); assert.equal(p.contactPatronAvailable, true); assert.equal(p.luckRemaining, 3);
  } finally { db.close(); }
});


test('Thought Shield reflection chains terminate and Eldritch Hex requires two dice on actual spell saves', () => {
  const { db, call, start, gm } = patronSetup();
  try {
    db.prepare('UPDATE characters SET class = ?, subclass = ?, level = 10 WHERE id = 2').run(hero(10).class, 'Great Old One Patron');
    const b = start().battle, actorId = b.fighters[0].id, enemyId = b.fighters[1].id, allyId = b.fighters[2].id;
    const reflected = call('act', { kind: 'resolve', note: 'psychic', targetId: actorId, sourceId: allyId, effect: 'damage', damageType: 'psychiczne', amount: 11 }, gm);
    assert.equal(reflected.status, 200); assert.equal(reflected.battle.fighters[0].hp, 34); assert.equal(reflected.battle.fighters[2].hp, 38);
    assert.equal(call('act', { kind: 'cast', slot: 'bonus', spellId: 'hex', source: 'pact', level: 5, targetIds: [enemyId], hexAbility: 'wis' }).status, 200);
    assert.equal(call('act', { kind: 'cast', slot: 'action', spellId: 'toll-the-dead', source: 'cantrip', level: 0, targetIds: [enemyId] }).status, 200);
    assert.equal(call('act', { kind: 'spell-save', targetId: enemyId, roll: 19 }, gm).status, 409);
    const failed = call('act', { kind: 'spell-save', targetId: enemyId, roll: 19, roll2: 1 }, gm);
    assert.equal(failed.status, 200); assert.equal(failed.battle.pending.targets[0].saved, false);
  } finally { db.close(); }
});
