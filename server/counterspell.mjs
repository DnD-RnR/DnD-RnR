import { randomUUID } from 'node:crypto';
import { casterData, resourceState, saveResources } from './spell-resources.mjs';
import { canSeeConditionTarget, isIncapacitated, exhaustionPenalty, conditionSaveAdvantage, conditionSaveDisadvantage, automaticSaveFailure, cannotHarm } from '../shared/conditions.mjs';
import { hasTimedModifier, timedRollModifier, timedSaveModifier } from '../shared/timed-effects.mjs';
import { hexDisadvantage, warlockProfile } from '../shared/warlock.mjs';
import { barbarianSaveAdvantage } from '../shared/barbarian.mjs';
import { consumeSavePenalty, hasSpellCondition } from './spell-conditions.mjs';
import { luckBonus } from './warlock-features.mjs';
import { endConcentration, startConcentration } from './concentration.mjs';
import { spellById } from '../shared/spellcasting.mjs';
import { spellAction } from '../shared/combat-spells.mjs';
import { endProtectiveSpell } from './protective-spells.mjs';

const check = (ok, message) => { if (!ok) throw new Error(message); };
export function counterspellReady(db, b, f, target) {
  if (!f || !target) return false;
  if (f.id === target.id || f.hp <= 0 || f.deathFailures >= 3 || f.reaction || f.rage || f.wildShape || isIncapacitated(f) || hasTimedModifier(f, 'slow') || hasSpellCondition(f, 'no-reactions') || !canSeeConditionTarget(f, target) || cannotHarm(f, target)) return false;
  if (!f.characterId) return Number.isInteger(f.counterspellDC);
  const c = casterData(db, f.characterId), spell = c.spells.find(s => s.id === 'counterspell');
  if (c.error || c.blocked || !spell || spell.dc == null) return false;
  return Boolean(spell.arcanumRemaining || spell.originFreeCast || spell.legacyFreeCast || !(b.slotCasters ?? []).includes(f.id) && c.slots.some(s => s.level >= 3 && s.remaining > 0));
}
function components(c) {
  const withoutVS = warlockProfile(c.character, c.stats.values.cha, c.state).greatOldOne && ['Enchantment', 'Illusion'].includes(c.spell.school);
  return c.spell.components.split(',').map(s => s.trim()).filter(s => !withoutVS || !['V', 'S'].includes(s)).join(', ');
}
export function castingProjection(p) {
  return { kind: 'casting', id: p.id, actorId: p.actorId, spellName: p.cast.spell.name, stage: p.stage, components: p.components, responders: p.responders, passed: p.passed, counterDC: p.counterDC, counterBy: p.counterBy };
}
export function beginCasting(db, b, caster, c, body, spentSlot, parent = null) {
  const actualComponents = components(c);
  const responders = /(^|,\s*)[VSM]\b/.test(actualComponents) ? b.fighters.filter(f => counterspellReady(db, b, f, caster)).map(f => f.id) : [];
  if (!responders.length && c.spell.id !== 'counterspell') return false;
  // Keep only data required to resolve this cast, not the caster's spell catalog
  // and selection groups (which can exceed the battle document size limit).
  const cast = { spell: c.spell, character: { class: c.character.class, subclass: c.character.subclass, level: c.character.level }, stats: { values: c.stats.values, traits: c.stats.traits }, state: {}, profile: { automatic: c.profile?.automatic.map(s => ({ id: s.id, reason: s.reason })) ?? [] }, ability: c.ability, attack: c.attack, dc: c.dc };
  b.pending = { kind: 'casting', id: randomUUID(), actorId: caster.id, cast, attempt: { ...body }, spentSlot, concentrationKey: caster.concentrationKey, stage: 'window', components: actualComponents, responders, passed: [], parent };
  if (!c.spell.duration?.includes('Koncentracja')) b.pending.concentrationKey = null;
  return true;
}
function finishFrame(db, b, frame, log) {
  if (frame.cast.spell.id === 'counterspell') {
    const parent = frame.parent;
    check(parent, 'Counterspell wymaga aktualnie rzucanego czaru.');
    parent.stage = 'save'; parent.counterDC = frame.cast.dc; parent.counterBy = frame.actorId;
    b.pending = parent;
    log(b, `Counterspell: ${b.fighters.find(f => f.id === parent.actorId).name} wykonuje CON przeciw ST ${frame.cast.dc}.`);
    return null;
  }
  b.pending = null;
  if (frame.monster) { monsterEffect(b, frame.actorId, frame.cast.spell, frame.attempt.slot); return null; }
  return frame;
}
function monsterEffect(b, actorId, spell, slot) {
  b.pending = { kind: 'request', actorId, slot, description: `${spell.name}: ${spell.description ?? ''}\nCzar potwora przeszedł okno reakcji. Efekty oraz zasoby potwora rozlicza MG.` };
}
export function handleMonsterCasting({ db, b, body, gm, log }) {
  if (!['monster-cast', 'monster-counterspell-config'].includes(body.kind)) return false;
  const f = b.fighters.find(f => f.id === body.actorId);
  check(gm && f && !f.characterId, 'Tylko MG deklaruje czary potwora.');
  if (body.kind === 'monster-counterspell-config') {
    check(!b.pending && (body.dc === null || Number.isInteger(body.dc) && body.dc >= 1 && body.dc <= 40), 'Podaj ST Counterspell poza rozpoczętym działaniem.');
    f.counterspellDC = body.dc; return true;
  }
  const spell = spellById.get(body.spellId), parent = spell?.id === 'counterspell' ? validateCounterspell(db, b, f, body) : null;
  check(spell && spellAction(spell) === body.slot && body.confirmedResources === true, 'MG musi potwierdzić czar, jego czas rzucania i dostępne zasoby potwora.');
  check(!b.pending || parent, 'Najpierw rozstrzygnij rozpoczęte działanie.');
  check(f.hp > 0 && !isIncapacitated(f) && !f[body.slot] && (f.id === b.fighters[b.turn].id || body.slot === 'reaction'), 'Potwór nie może teraz rzucić tego czaru.');
  check(Number.isInteger(body.level) && body.level >= spell.level && body.level <= 9 && (spell.level > 0 || body.level === 0), 'Niepoprawny krąg czaru potwora.');
  check(typeof body.usesSlot === 'boolean' && (!body.usesSlot || spell.level > 0 && !(b.slotCasters ?? []).includes(f.id)), 'Potwierdź, czy potwór wydaje miejsce na czar; obowiązuje jedno miejsce na turę.');
  if (body.usesSlot) b.slotCasters = [...(b.slotCasters ?? []), f.id];
  f[body.slot] = `Czar: ${spell.name}`; endProtectiveSpell(db, f, 'sanctuary');
  if (spell.duration.includes('Koncentracja')) startConcentration(db, f, spell, b);
  const c = { spell: { ...spell, action: body.slot, components: body.withoutComponents === true ? '' : spell.components }, character: {}, stats: { values: {} }, state: {}, dc: f.counterspellDC };
  log(b, `${f.name}: MG deklaruje rzucanie ${spell.name} (${body.level}. krąg).`);
  if (beginCasting(db, b, f, c, body, body.usesSlot, parent)) {
    b.pending.monster = true;
    advanceCasting(db, b, log);
  } else monsterEffect(b, f.id, spell, body.slot);
  return true;
}
export function advanceCasting(db, b, log) {
  const p = b.pending;
  if (p?.kind !== 'casting' || p.stage !== 'window') return null;
  const target = b.fighters.find(f => f.id === p.actorId);
  p.responders = p.responders.filter(id => p.passed.includes(id) || counterspellReady(db, b, b.fighters.find(f => f.id === id), target));
  return p.responders.every(id => p.passed.includes(id)) ? finishFrame(db, b, p, log) : null;
}
export function validateCounterspell(db, b, caster, body) {
  const parent = b.pending;
  check(body.castingId === parent?.id, 'To okno reakcji jest już nieaktualne.');
  check(parent?.kind === 'casting' && parent.stage === 'window' && parent.responders.includes(caster.id) && !parent.passed.includes(caster.id), 'Counterspell: brak twojego okna reakcji.');
  check(counterspellReady(db, b, caster, b.fighters.find(f => f.id === parent.actorId)), 'Counterspell: reakcja lub czar jest niedostępny.');
  check(body.confirmedCounterspell === true, 'MG musi potwierdzić widocznego rzucającego w 60 stopach i komponent V, S lub M.');
  check(b.fighters.find(f => f.id === parent.actorId).saves.con != null, 'Uzupełnij rzut obronny CON rzucającego.');
  parent.passed.push(caster.id);
  return parent;
}
export function handleCasting({ db, b, body, gm, canControl, activeMember, log }) {
  if (!['casting-pass', 'casting-continue', 'counterspell-save'].includes(body.kind)) return false;
  const p = b.pending;
  check(p?.kind === 'casting', 'Brak rzucanego czaru.');
  check(body.castingId === p.id, 'To okno reakcji jest już nieaktualne.');
  const caster = b.fighters.find(f => f.id === p.actorId);
  const controlled = f => f && canControl(f) && activeMember(db, b.sessionId, f);
  if (body.kind === 'casting-pass') {
    const responder = b.fighters.find(f => f.id === body.actorId);
    check(p.stage === 'window' && controlled(responder) && p.responders.includes(responder.id) && !p.passed.includes(responder.id), 'Nie możesz pominąć tej reakcji.');
    p.passed.push(responder.id);
    log(b, `${responder.name}: nie używa Counterspell (reakcja pozostaje wolna).`);
    return { resume: advanceCasting(db, b, log) };
  }
  if (body.kind === 'casting-continue') {
    check(gm && p.stage === 'window', 'Tylko MG potwierdza brak dalszych reakcji.');
    p.passed = [...p.responders];
    return { resume: finishFrame(db, b, p, log) };
  }
  check(p.stage === 'save' && controlled(caster) && caster.saves.con != null, 'CON wykonuje właściciel rzucającego.');
  const adv = Boolean(body.advantage || conditionSaveAdvantage(caster, 'con') || barbarianSaveAdvantage(caster, 'con'));
  const dis = Boolean(body.disadvantage || conditionSaveDisadvantage(caster, 'con') || hexDisadvantage(b, caster, 'con'));
  const die = n => Number.isInteger(n) && n >= 1 && n <= 20;
  const autoFail = automaticSaveFailure(caster, 'con');
  check(autoFail || die(body.roll) && (adv === dis || die(body.roll2)), 'Podaj k20 i drugą kość przy ułatwieniu/utrudnieniu.');
  const roll = adv === dis ? body.roll : adv ? Math.max(body.roll, body.roll2) : Math.min(body.roll, body.roll2);
  const penalty = consumeSavePenalty(caster, autoFail ? 1 : body.mindSliverRoll);
  const total = autoFail ? -Infinity : roll + caster.saves.con - exhaustionPenalty(caster) + timedSaveModifier(caster, 'con') + timedRollModifier(caster, body) + (caster.characterId ? luckBonus(db, caster.characterId, body.luckRoll) : 0) - penalty;
  const success = total >= p.counterDC;
  log(b, `${caster.name}: CON przeciw Counterspell — ${success ? 'sukces, czar trwa' : 'porażka, czar przerwany'}.`);
  if (success) {
    p.stage = 'window';
    return { resume: advanceCasting(db, b, log) };
  }
  if (p.spentSlot) {
    if (caster.characterId) {
      const state = resourceState(db, caster.characterId);
      if (p.attempt.source === 'pact') state.pactSpent = Math.max(0, state.pactSpent - 1);
      else state.spent[p.attempt.level - 1] = Math.max(0, state.spent[p.attempt.level - 1] - 1);
      saveResources(db, caster.characterId, state);
    }
    b.slotCasters = (b.slotCasters ?? []).filter(id => id !== caster.id);
    log(b, `${caster.name}: miejsce na przerwany czar nie zostało zużyte; działanie pozostaje zużyte.`);
  }
  if (p.concentrationKey && caster.concentrationKey === p.concentrationKey) endConcentration(db, caster);
  b.pending = p.parent ?? null;
  return { resume: advanceCasting(db, b, log) };
}
