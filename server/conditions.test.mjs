import { test } from 'node:test';
import assert from 'node:assert/strict';
import { automaticCheckFailure, automaticSaveFailure, conditionAttackModifiers, conditionSaveDisadvantage, conditionSpeedZero, conditionsOf, hasCondition, isIncapacitated } from '../shared/conditions.mjs';
import { barbarianSaveAdvantage } from '../shared/barbarian.mjs';

test('SRD condition implications preserve the distinction between incapacitation and speed zero', () => {
  for (const id of ['incapacitated', 'stunned']) {
    const f = { hp: 10, manualConditions: [id] };
    assert.equal(isIncapacitated(f), true);
    assert.equal(conditionSpeedZero(f), false, id);
  }
  for (const id of ['paralyzed', 'petrified', 'unconscious']) {
    const f = { hp: 10, manualConditions: [id] };
    assert.equal(isIncapacitated(f), true);
    assert.equal(conditionSpeedZero(f), true);
    assert.equal(automaticSaveFailure(f, 'str'), true);
    assert.equal(automaticSaveFailure(f, 'dex'), true);
    assert.equal(automaticSaveFailure(f, 'con'), false);
  }
  assert.equal(automaticSaveFailure({ manualConditions: ['stunned'] }, 'dex'), true);
  assert.equal(automaticSaveFailure({ manualConditions: ['incapacitated'] }, 'dex'), false);
  assert.equal(hasCondition({ hp: 0 }, 'unconscious'), true);
  assert.equal(hasCondition({ manualConditions: ['unconscious'] }, 'prone'), true);
});

test('multiple sources do not stack conditions, and Petrified suppresses Poisoned without deleting its source', () => {
  const f = { manualConditions: ['poisoned'], spellConditions: [{ kind: 'poisoned' }], timedEffects: [{ spellId: 'test', createdAt: 1, modifiers: { condition: 'poisoned' } }] };
  assert.deepEqual([...conditionsOf(f)], ['poisoned']);
  f.manualConditions.push('petrified');
  assert.equal(hasCondition(f, 'poisoned'), false);
  assert.equal(hasCondition(f, 'petrified'), true);
  f.manualConditions.pop();
  assert.equal(hasCondition(f, 'poisoned'), true);
});

test('Prone changes incoming advantage by distance, and own disadvantage cancels incoming advantage only once', () => {
  const prone = { manualConditions: ['prone'] };
  assert.deepEqual(conditionAttackModifiers({}, prone, { within5Feet: true }), { advantage: true, disadvantage: false, criticalOnHit: false });
  assert.deepEqual(conditionAttackModifiers({}, prone, { within5Feet: false }), { advantage: false, disadvantage: true, criticalOnHit: false });
  assert.deepEqual(conditionAttackModifiers(prone, prone, { within5Feet: true }), { advantage: true, disadvantage: true, criticalOnHit: false });
  assert.equal(conditionAttackModifiers({}, { manualConditions: ['stunned'] }, { within5Feet: true }).criticalOnHit, false);
  for (const id of ['paralyzed', 'unconscious']) {
    assert.equal(conditionAttackModifiers({}, { manualConditions: [id] }, { within5Feet: true }).criticalOnHit, true);
    assert.equal(conditionAttackModifiers({}, { manualConditions: [id] }, { within5Feet: false }).criticalOnHit, false);
  }
});

test('sight, hearing and Dexterity-save restrictions follow distinct condition rules', () => {
  assert.equal(automaticCheckFailure({ manualConditions: ['blinded'] }, { requiresSight: true }), true);
  assert.equal(automaticCheckFailure({ manualConditions: ['blinded'] }, { requiresHearing: true }), false);
  assert.equal(automaticCheckFailure({ manualConditions: ['deafened'] }, { requiresHearing: true }), true);
  assert.equal(automaticCheckFailure({ manualConditions: ['deafened'] }, { requiresSight: true }), false);
  assert.equal(conditionSaveDisadvantage({ manualConditions: ['restrained'] }, 'dex'), true);
  assert.equal(conditionSaveDisadvantage({ manualConditions: ['restrained'] }, 'con'), false);
  assert.equal(isIncapacitated({ manualConditions: ['restrained'] }), false);
});

test('Danger Sense recognizes incapacitation from persisted manual and spell sources', () => {
  const f = { hp: 10, rageProfile: { dangerSense: true } };
  assert.equal(barbarianSaveAdvantage(f, 'dex'), true);
  assert.equal(barbarianSaveAdvantage({ ...f, manualConditions: ['incapacitated'] }, 'dex'), false);
  assert.equal(barbarianSaveAdvantage({ ...f, timedEffects: [{ spellId: 'power-word-stun', createdAt: 1, modifiers: { condition: 'stunned' } }] }, 'dex'), false);
});
