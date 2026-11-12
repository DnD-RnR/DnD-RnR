import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pactMagicUpdate, invocationUpdate } from './warlock.mjs';
import { invocations, invocationCount, invocationOptions } from '../shared/warlock-invocations.mjs';
import { invocationDescriptions, invocationSheet } from '../shared/warlock-invocation-effects.mjs';
import { characterTraits, validateTraitSelection } from '../shared/character-traits.mjs';
import { handleStatistics, emptyStatistics } from './statistics.mjs';
import { openDatabase } from './db.mjs';
import progression from '../shared/spell-progression.json' with { type: 'json' };

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
  assert.ok(validate(2, ['eldritch-spear:chill-touch', 'eldritch-mind', 'armor-of-shadows'], ['chill-touch']).error);
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
