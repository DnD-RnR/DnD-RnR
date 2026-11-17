import { cannotHarm } from '../shared/conditions.mjs';
import { randomUUID } from 'node:crypto';
import { resourceState, saveResources } from './spell-resources.mjs';
import { endConcentration } from './concentration.mjs';
import { isIncapacitated } from '../shared/conditions.mjs';
const check = (ok, message) => { if (!ok) throw new Error(message); };

export function createRepeatSpell(db, b, source, pending, options = {}) {
  const effect = { id: randomUUID(), sourceId: source.id, sourceName: source.name,
    concentrationKey: source.concentrationKey, spellId: pending.spellId, name: pending.spellName,
    createdRound: b.round, spec: { ...pending.spec }, attackBonus: pending.attackBonus,
    level: pending.castingLevel,
    dc: pending.dc, targetId: pending.targets[0]?.id,
    targetCharacterId: b.fighters.find(f => f.id === pending.targets[0]?.id)?.characterId,
    targetName: b.fighters.find(f => f.id === pending.targets[0]?.id)?.name,
    contactIds: pending.targets.map(t => t.id), ...options };
  b.repeatSpells ??= [];
  b.repeatSpells.push(effect);
  const state = resourceState(db, source.characterId); state.activeRepeatSpell = effect;
  saveResources(db, source.characterId, state);
  pending.repeatSpellId = effect.id;
  return effect;
}
export function restoreRepeatSpells(db, b) {
  b.repeatSpells = [];
  for (const source of b.fighters.filter(f => f.characterId)) {
    const effect = resourceState(db, source.characterId).activeRepeatSpell;
    if (!effect || !source.concentration || effect.concentrationKey !== source.concentrationKey) continue;
    const target = b.fighters.find(f => effect.targetCharacterId && f.characterId === effect.targetCharacterId);
    b.repeatSpells.push({ ...effect, sourceId: source.id, createdRound: 0,
      targetId: target?.id ?? null, contactIds: [], needsConfirmation: effect.spellId !== 'spiritual-weapon' });
  }
}
export function syncRepeatSpells(db, b) {
  b.repeatSpells = (b.repeatSpells ?? []).filter(e => {
    const source = b.fighters.find(f => f.id === e.sourceId);
    const active = source?.concentration && source.concentrationKey === e.concentrationKey && !isIncapacitated(source);
    if (!active && source?.characterId) {
      const state = resourceState(db, source.characterId);
      if (state.activeRepeatSpell?.id === e.id) { delete state.activeRepeatSpell; saveResources(db, source.characterId, state); }
    }
    return active;
  });
  if (b.pending?.repeatSpellId && !b.repeatSpells.some(e => e.id === b.pending.repeatSpellId) && b.pending.stage !== 'heat-save') b.pending = null;
}
export function handleRepeatSpell({ db, b, body, gm, canControl, activeMember, log }) {
  if (!['repeat-spell', 'repeat-contacts', 'repeat-end'].includes(body.kind)) return false;
  const e = b.repeatSpells?.find(e => e.id === body.effectId), source = b.fighters.find(f => f.id === e?.sourceId);
  check(e && source, 'Ten efekt już nie działa.');
  if (body.kind === 'repeat-end') {
    check(gm, 'Zasięg, pełną osłonę i koniec efektu zatwierdza MG.');
    endConcentration(db, source); log(b, `${e.name}: MG potwierdza zakończenie efektu.`); return true;
  }
  check(!b.pending && !b.suspendedAction && !b.fighters.some(f => f.concentrationDC), 'Najpierw rozlicz rozpoczęte działanie i koncentrację.');
  if (body.kind === 'repeat-contacts') {
    check(gm && e.spellId !== 'spiritual-weapon', 'Kontakty z obiektem i ciągłość celu zatwierdza MG.');
    check(Array.isArray(body.targetIds) && new Set(body.targetIds).size === body.targetIds.length && body.targetIds.every(id => b.fighters.some(f => f.id === id && f.deathFailures < 3)), 'Wybierz właściwe cele.');
    if (e.spellId === 'witch-bolt') {
      check(e.needsConfirmation && body.targetIds.length === 1 && (!e.targetCharacterId || b.fighters.find(f => f.id === body.targetIds[0])?.characterId === e.targetCharacterId), 'Witch Bolt nie pozwala zmienić pierwotnego celu.');
      e.targetId = body.targetIds[0];
    } else e.contactIds = body.targetIds;
    e.needsConfirmation = false;
    return true;
  }
  check(source.id === b.fighters[b.turn].id && canControl(source) && activeMember(db, b.sessionId, source) && !isIncapacitated(source) && source.spellTurnEnded !== b.round, 'Wymagana własna aktywna tura rzucającego.');
  check(!source.bonus && b.round !== e.createdRound && !e.needsConfirmation && body.confirmed === true, 'Wymagana późniejsza tura, wolna akcja bonusowa i potwierdzone warunki zasięgu przez MG.');
  const ids = e.spellId === 'witch-bolt' ? [e.targetId] : e.spellId === 'heat-metal' ? e.contactIds : body.targetId ? [body.targetId] : [];
  check(ids.every(id => b.fighters.some(f => f.id === id && f.deathFailures < 3)), 'Cel nie jest dostępny.');
  check(ids.every(id => !cannotHarm(source, b.fighters.find(f => f.id === id))), 'Charmed: nie możesz kierować szkodliwego efektu na sprawcę.');
  const spec = { ...e.spec };
  if (e.spellId === 'witch-bolt') Object.assign(spec, { mode: 'save', save: undefined, dice: 1, bonus: 0, perLevel: 0 });
  source.bonus = `${e.name}: ponowienie`;
  if (ids.length) b.pending = { kind: 'spell', actorId: source.id, repeatSpellId: e.id,
    spellId: e.spellId, spellName: e.name, spec, concentrationKey: e.concentrationKey,
    attackBonus: e.attackBonus, dc: e.dc, stage: spec.mode === 'attack' ? 'attack' : 'effect', targets: ids.map(id => ({ id })) };
  log(b, `${source.name}: ${e.name} — akcja bonusowa, bez kolejnego miejsca na czar${ids.length ? '' : ' (bez ataku / bez kontaktów)'}.`);
  return true;
}
