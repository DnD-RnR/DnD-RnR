import { randomUUID } from 'node:crypto';
import { resourceState, saveResources } from './spell-resources.mjs';
import { endConcentration } from './concentration.mjs';
import { automaticSaveFailure, isIncapacitated } from '../shared/conditions.mjs';

const check = (ok, message) => { if (!ok) throw new Error(message); };
const token = b => `${b.round}:${b.fighters[b.turn].id}`;
const alive = f => f && f.deathFailures < 3 && (f.characterId || f.hp > 0);

export function createSpellZone(db, b, source, spell, level, spec, dc, memberIds) {
  const zone = { id: randomUUID(), spellId: spell.id, name: spell.name, sourceId: source.id,
    sourceName: source.name, concentrationKey: source.concentrationKey, level, dc,
    spec: { ...spec, zone: undefined }, memberIds, lastMovedRound: b.round,
    order: b.zoneOrder = (b.zoneOrder ?? 0) + 1, triggered: {} };
  b.spellZones ??= [];
  b.spellZones.push(zone);
  const state = resourceState(db, source.characterId);
  state.activeSpellZone = { ...zone, memberIds: [], triggered: {} };
  saveResources(db, source.characterId, state);
  return zone;
}

export function restoreSpellZones(db, b) {
  b.spellZones = [];
  for (const source of b.fighters.filter(f => f.characterId)) {
    const state = resourceState(db, source.characterId), saved = state.activeSpellZone;
    if (!saved || !source.concentration || saved.concentrationKey !== source.concentrationKey) continue;
    b.spellZones.push({ ...saved, sourceId: source.id, memberIds: [], triggered: {}, lastMovedRound: 0, needsPlacement: true });
    b.zoneOrder = Math.max(b.zoneOrder ?? 0, saved.order);
  }
}

export function syncSpellZones(db, b) {
  const before = b.spellZones ?? [];
  b.spellZones = before.filter(z => {
    const source = b.fighters.find(f => f.id === z.sourceId);
    return source?.concentration && source.concentrationKey === z.concentrationKey && !isIncapacitated(source);
  });
  for (const z of before.filter(z => !b.spellZones.includes(z))) {
    const source = b.fighters.find(f => f.id === z.sourceId);
    if (source?.characterId) {
      const state = resourceState(db, source.characterId);
      if (state.activeSpellZone?.id === z.id) { delete state.activeSpellZone; saveResources(db, source.characterId, state); }
    }
  }
  for (const z of b.spellZones) {
    z.memberIds = z.memberIds.filter(id => alive(b.fighters.find(f => f.id === id)));
    z.triggered = Object.fromEntries(Object.entries(z.triggered).filter(([, turn]) => turn === token(b)));
  }
  if (b.pending?.zoneId && !b.spellZones.some(z => z.id === b.pending.zoneId)) b.pending = null;
}

export function zoneMovementDue(b) {
  return (b.spellZones ?? []).some(z => z.needsPlacement || z.sourceId === b.fighters[b.turn].id && z.lastMovedRound !== b.round);
}

export function eligibleZoneTargets(b, zone, targetIds) {
  return targetIds.filter(id => {
    if (zone.triggered[id] === token(b)) return false;
    // Overlapping spells with the same name do not combine. Strongest wins;
    // the most recently created casting wins a tie.
    const contenders = (b.spellZones ?? []).filter(z => z.spellId === zone.spellId && (z.id === zone.id || z.memberIds.includes(id)));
    const winner = contenders.sort((a, c) => c.spec.dice - a.spec.dice || c.order - a.order)[0];
    return winner?.id === zone.id;
  });
}

export function beginZoneDamage(b, zone, targetIds, endTurn = false) {
  check(!b.pending && !b.suspendedAction, 'Najpierw rozstrzygnij rozpoczęte działanie.');
  const ids = eligibleZoneTargets(b, zone, targetIds);
  if (!ids.length) return false;
  const targets = ids.map(id => b.fighters.find(f => f.id === id));
  check(targets.every(f => alive(f) && (automaticSaveFailure(f, zone.spec.save) || f.saves?.[zone.spec.save] != null)), 'Uzupełnij rzut obronny celu strefy.');
  for (const id of ids) zone.triggered[id] = token(b);
  if (endTurn) b.fighters[b.turn].spellTurnEnded = b.round;
  b.pending = { kind: 'spell', actorId: targets[0].id, sourceId: zone.sourceId,
    zoneId: zone.id, zoneEvent: true, spellId: zone.spellId, spellName: zone.name,
    stage: 'save', spec: { ...zone.spec }, concentrationKey: zone.concentrationKey,
    dc: zone.dc, targets: ids.map(id => ({ id })) };
  return true;
}

export function dueZoneDamage(b, fighter) {
  return (b.spellZones ?? []).filter(z => !z.needsPlacement && z.memberIds.includes(fighter.id) && eligibleZoneTargets(b, z, [fighter.id]).length);
}

export function handleSpellZone({ db, b, body, gm, log }) {
  if (!['zone-enter', 'zone-leave', 'zone-move', 'zone-place', 'zone-end', 'zone-end-turn'].includes(body.kind)) return false;
  check(gm, 'Pozycje i wyzwalacze stref zatwierdza MG.');
  check(!b.pending && !b.suspendedAction && !b.fighters.some(f => f.concentrationDC), 'Najpierw rozstrzygnij rozpoczęte działanie i koncentrację.');
  const zone = b.spellZones?.find(z => z.id === body.zoneId);
  check(zone, 'Ta strefa już nie działa.');
  if (body.kind === 'zone-end') {
    endConcentration(db, b.fighters.find(f => f.id === zone.sourceId));
    log(b, `${zone.name}: MG kończy strefę (np. rozproszenie silnym wiatrem).`);
  } else if (['zone-move', 'zone-place'].includes(body.kind)) {
    check(body.kind === 'zone-place' ? zone.needsPlacement : !zone.needsPlacement && zone.sourceId === b.fighters[b.turn].id && zone.lastMovedRound !== b.round, 'Przesunięcie chmury następuje raz na początku tury rzucającego.');
    check(Array.isArray(body.memberIds) && new Set(body.memberIds).size === body.memberIds.length && body.memberIds.every(id => alive(b.fighters.find(f => f.id === id))), 'Wybierz obecne cele w chmurze.');
    check(Array.isArray(body.targetIds) && new Set(body.targetIds).size === body.targetIds.length && body.targetIds.every(id => alive(b.fighters.find(f => f.id === id))), 'Wybierz cele objęte przesunięciem lub wejściem.');
    zone.memberIds = body.memberIds;
    if (body.kind === 'zone-move') zone.lastMovedRound = b.round;
    zone.needsPlacement = false;
    beginZoneDamage(b, zone, body.targetIds);
    log(b, `${zone.name}: MG ${body.kind === 'zone-move' ? 'potwierdza przesunięcie o 10 stóp od rzucającego' : 'odtwarza położenie strefy'} i wskazuje cele.`);
  } else {
    const target = b.fighters.find(f => f.id === body.targetId);
    check(alive(target) && !zone.needsPlacement, 'Wybierz cel aktywnej strefy.');
    if (body.kind === 'zone-leave') zone.memberIds = zone.memberIds.filter(id => id !== target.id);
    else if (body.kind === 'zone-enter') {
      if (!zone.memberIds.includes(target.id)) zone.memberIds.push(target.id);
      beginZoneDamage(b, zone, [target.id]);
    } else {
      check(target.id === b.fighters[b.turn].id && zone.memberIds.includes(target.id), 'Rozlicz koniec własnej tury w strefie.');
      check(beginZoneDamage(b, zone, [target.id], true), 'Ten cel już rozliczył ten czar w tej turze lub działa silniejsza strefa.');
    }
    log(b, `${zone.name} → ${target.name}: ${body.kind === 'zone-leave' ? 'opuszczenie strefy' : body.kind === 'zone-enter' ? 'wejście w strefę' : 'koniec tury w strefie'}.`);
  }
  return true;
}
