import { test } from 'node:test';
import assert from 'node:assert/strict';
import { druidChoiceUpdate, applyWildShape, endWildShape } from './druid.mjs';
import { druidForms, druidProfile } from '../shared/druid.mjs';
import { emptyStatistics } from './statistics.mjs';
import { spellcastingProfile } from '../shared/spellcasting.mjs';
import { characterTraits } from '../shared/character-traits.mjs';

const hero = level => ({ class: 'Druid', level, species: '', background: '', subclass: '' });
const choices = (level = 1) => ({ spells: { choices: { order: 'magic' }, selections: { cantrips: ['druidcraft', 'produce-flame', 'guidance'], prepared: ['cure-wounds', 'faerie-fire', 'thunderwave', 'entangle', ...(level === 2 ? ['healing-word'] : [])] } }, traits: level === 2 ? { druidForms: ['rat', 'riding-horse', 'spider', 'wolf'] } : {} });
const stored = result => ({ druidProgression: result.history });

test('Druid levels 1–2 have correct slots, orders, Druidic and known forms', () => {
  for (const level of [1, 2]) {
    const stats = { ...emptyStatistics(), ...choices(level) };
    stats.values.wis = 16;
    const profile = spellcastingProfile(hero(level), stats.spells);
    assert.equal(profile.slots[0], level + 1);
    assert.equal(profile.groups.find(g => g.id === 'prepared').limit, level + 3);
    assert.equal(profile.groups.find(g => g.id === 'cantrips').limit, 3);
    assert.ok(profile.automatic.some(s => s.id === 'speak-with-animals'));
    assert.equal(characterTraits(hero(level), stats).skillBonuses.arcana, 3);
    stats.spells.choices.order = 'martial';
    assert.ok(characterTraits(hero(level), stats).weapons.includes('Martial weapons'));
    assert.equal(druidProfile(hero(level)).max, level === 2 ? 2 : 0);
  }
});

test('cantrip replacement budgets survive saves, orders lock, prepared spells require long rest', () => {
  const initial = druidChoiceUpdate(hero(1), choices(), null, {}, true, true);
  assert.ok(initial.history);
  const changed = choices(); changed.spells.selections.cantrips[0] = 'mending';
  assert.ok(druidChoiceUpdate(hero(1), changed, stored(initial), {}, true, false).error);
  const next = choices(2); next.spells.selections.cantrips[0] = 'mending';
  const advanced = druidChoiceUpdate(hero(2), next, stored(initial), {}, true, true);
  assert.ok(advanced.history);
  next.spells.selections.cantrips[1] = 'resistance';
  assert.ok(druidChoiceUpdate(hero(2), next, stored(advanced), {}, true, false).error);
  const prepared = choices(); prepared.spells.selections.prepared[0] = 'healing-word';
  assert.ok(druidChoiceUpdate(hero(1), prepared, stored(initial), {}, true, false).error);
  assert.ok(druidChoiceUpdate(hero(1), prepared, stored(initial), { lastLongRest: 123 }, true, false).history);
  const unrelatedSave = druidChoiceUpdate(hero(1), choices(), stored(initial), { lastLongRest: 123 }, false, false);
  assert.ok(druidChoiceUpdate(hero(1), prepared, stored(unrelatedSave), { lastLongRest: 123 }, true, false).history);
  const order = choices(); order.spells.choices.order = 'martial';
  assert.ok(druidChoiceUpdate(hero(1), order, stored(initial), {}, true, false).error);
});

test('only one known form can be exchanged per long rest', () => {
  const initial = druidChoiceUpdate(hero(2), choices(2), null, {}, true, true);
  const changed = choices(2); changed.traits.druidForms[0] = 'cat';
  assert.ok(druidChoiceUpdate(hero(2), changed, stored(initial), {}, false, true).error);
  const rested = druidChoiceUpdate(hero(2), changed, stored(initial), { lastLongRest: 1 }, false, true);
  assert.ok(rested.history);
  assert.ok(druidChoiceUpdate(hero(2), choices(2), stored(rested), { lastLongRest: 1 }, false, true).error);
});

test('Wild Shape replaces physical statistics while keeping HP, mental saves and concentration', () => {
  const stats = emptyStatistics(); Object.assign(stats.values, { str: 8, dex: 10, con: 14, int: 12, wis: 16, cha: 10 });
  stats.traits = { classSkills: ['perception', 'survival'] };
  const f = { ac: 15, speed: 30, hp: 17, maxHp: 19, tempHp: 0, saves: { wis: 5 }, attacks: [], maxAttacks: 1, concentration: 'entangle', notes: '' };
  applyWildShape(f, druidForms.find(f => f.id === 'wolf'), hero(2), stats, { formId: 'wolf', expiresAt: Date.now() + 1000 });
  assert.equal(f.hp, 17); assert.equal(f.maxHp, 19); assert.equal(f.concentration, 'entangle');
  assert.equal(f.ac, 12); assert.equal(f.speed, 40); assert.equal(f.saves.wis, 5); assert.equal(f.formSkills.perception, 7);
  assert.equal(f.attacks[0].id, 'beast:wolf');
  endWildShape(f); assert.equal(f.ac, 15); assert.equal(f.speed, 30); assert.equal(f.wildShape, null);
});
