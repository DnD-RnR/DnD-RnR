import { randomUUID } from 'node:crypto';
import { resourceState, saveResources } from './spell-resources.mjs';
import { endConcentration } from './concentration.mjs';
import { automaticSaveFailure, isIncapacitated } from '../shared/conditions.mjs';
import { handleBarbarian } from './barbarian.mjs';

const check = (ok, message) => { if (!ok) throw new Error(message); };
const token = b => `${b.round}:${b.fighters[b.turn].id}`;
const alive = f => f && f.deathFailures < 3 && (f.characterId || f.hp > 0);
const triggerKey = (zone, id, endTurn, phase) => zone.spec.wall || zone.spec.binding === 'web' ? `${id}:${phase ?? (endTurn ? 'end' : 'entry')}` : zone.spec.separateCollision ? `${id}:${endTurn ? 'end' : 'collision'}` : id;

export function characterZoneConditions(db, characterId) {
  return db.prepare('SELECT data FROM character_spell_resources').all().map(row => JSON.parse(row.data)).filter(state => state.concentration && state.activeSpellZone && state.activeSpellZone.concentrationKey === state.concentrationKey && state.activeSpellZone.restrainedCharacterIds?.includes(characterId)).map(state => ({ kind: 'restrained', zoneId: state.activeSpellZone.id }));
}

export function createSpellZone(db, b, source, spell, level, spec, dc, memberIds, options = {}) {
  const zone = { id: randomUUID(), spellId: spell.id, name: spell.name, sourceId: source.id,
    sourceName: source.name, concentrationKey: source.concentrationKey, level, dc,
    spec: { ...spec, zone: undefined }, memberIds, lastMovedRound: b.round, createdRound: b.round, shapeLockedIds: [],
    order: b.zoneOrder = (b.zoneOrder ?? 0) + 1, triggered: {}, startToken: token(b), startMemberIds: [], startFireEligible: false, restrainedIds: [], fires: [], ...options };
  b.spellZones ??= [];
  b.spellZones.push(zone);
  const state = resourceState(db, source.characterId);
  if (spell.id === 'web' && options.webAnchored === false) { source.concentrationExpiresRound = b.round + 1; state.concentrationRemainingSeconds = 6; }
  state.activeSpellZone = { ...zone, memberIds: [], triggered: {} };
  saveResources(db, source.characterId, state);
  return zone;
}

export function restoreSpellZones(db, b) {
  b.spellZones = [];
  for (const source of b.fighters.filter(f => f.characterId)) {
    const state = resourceState(db, source.characterId), saved = state.activeSpellZone;
    if (!saved || !source.concentration || saved.concentrationKey !== source.concentrationKey) continue;
    b.spellZones.push({ ...saved, sourceId: source.id, memberIds: [], fires: [], restrainedIds: b.fighters.filter(f => saved.restrainedCharacterIds?.includes(f.characterId)).map(f => f.id), wallIds: [], excludedIds: b.fighters.filter(f => saved.excludedCharacterIds?.includes(f.characterId)).map(f => f.id), shapeLockedIds: b.fighters.filter(f => saved.shapeLockedCharacterIds?.includes(f.characterId)).map(f => f.id), moveReady: null, createdRound: 0, triggered: {}, lastMovedRound: 0, needsPlacement: true });
    if (saved.spec.binding === 'web' && saved.webAnchored === false) source.concentrationExpiresRound = b.round;
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
    z.shapeLockedIds = (z.shapeLockedIds ?? []).filter(id => z.needsPlacement || z.memberIds.includes(id));
    z.restrainedIds = (z.restrainedIds ?? []).filter(id => alive(b.fighters.find(f => f.id === id)) && (z.spec.binding !== 'web' || z.needsPlacement || z.memberIds.includes(id)));
    for (const fire of z.fires ?? []) {
      const endIndex = b.fighters.findIndex(f => f.id === fire.endTurnId);
      if (!fire.expired && (b.round > fire.endRound || b.round === fire.endRound && (endIndex >= 0 ? b.turn >= endIndex : b.fighters[b.turn].initiative <= fire.endInitiative))) {
        fire.expired = true; z.needsPlacement = true;
      }
      fire.memberIds = fire.memberIds.filter(id => z.memberIds.includes(id));
    }
    if (z.startToken !== token(b)) {
      z.startToken = token(b);
      z.startMemberIds = z.memberIds.includes(b.fighters[b.turn].id) ? [b.fighters[b.turn].id] : [];
      z.startFireEligible = z.fires?.some(f => !f.expired && f.memberIds.includes(b.fighters[b.turn].id));
    }
    const source = b.fighters.find(f => f.id === z.sourceId);
    if (source?.characterId) {
      const state = resourceState(db, source.characterId);
      const locked = z.shapeLockedIds.map(id => b.fighters.find(f => f.id === id)?.characterId).filter(Boolean);
      if (state.activeSpellZone?.id === z.id && JSON.stringify(state.activeSpellZone.shapeLockedCharacterIds ?? []) !== JSON.stringify(locked)) {
        state.activeSpellZone.shapeLockedCharacterIds = locked; saveResources(db, source.characterId, state);
      }
      const restrained = z.restrainedIds.map(id => b.fighters.find(f => f.id === id)?.characterId).filter(Boolean);
      if (state.activeSpellZone?.id === z.id && JSON.stringify(state.activeSpellZone.restrainedCharacterIds ?? []) !== JSON.stringify(restrained)) {
        state.activeSpellZone.restrainedCharacterIds = restrained; saveResources(db, source.characterId, state);
      }
    }
    z.triggered = Object.fromEntries(Object.entries(z.triggered).filter(([, turn]) => turn === token(b)));
  }
  if (b.pending?.zoneId && !b.spellZones.some(z => z.id === b.pending.zoneId)) b.pending = null;
  for (const f of b.fighters) f.zoneSpeedHalved = b.spellZones.some(z => z.spec.aura && !z.needsPlacement && z.memberIds.includes(f.id) && !z.excludedIds?.includes(f.id));
  for (const f of b.fighters) {
    f.zoneConditions = b.spellZones.filter(z => z.restrainedIds?.includes(f.id)).map(z => ({ kind: 'restrained', zoneId: z.id }));
    f.zoneDifficultTerrain = b.spellZones.some(z => z.spec.difficultTerrain && !z.needsPlacement && z.memberIds.includes(f.id));
  }
}

export function zoneMovementDue(b) {
  return (b.spellZones ?? []).some(z => z.needsPlacement || z.moveReady || !z.spec.stationary && !z.spec.moveSlot && z.sourceId === b.fighters[b.turn].id && z.lastMovedRound !== b.round);
}

export function eligibleZoneTargets(b, zone, targetIds, endTurn = false, phase) {
  return targetIds.filter(id => {
    if (zone.excludedIds?.includes(id) || zone.triggered[triggerKey(zone, id, endTurn, phase)] === token(b)) return false;
    // Overlapping spells with the same name do not combine. Strongest wins;
    // the most recently created casting wins a tie.
    const contenders = (b.spellZones ?? []).filter(z => z.spellId === zone.spellId && !z.excludedIds?.includes(id) && (z.id === zone.id || z.memberIds.includes(id)));
    const winner = contenders.sort((a, c) => c.spec.dice - a.spec.dice || c.order - a.order)[0];
    return winner?.id === zone.id;
  });
}

export function beginZoneDamage(b, zone, targetIds, endTurn = false, phase) {
  check(!b.pending && !b.suspendedAction, 'Najpierw rozstrzygnij rozpoczęte działanie.');
  const ids = eligibleZoneTargets(b, zone, targetIds, endTurn, phase);
  if (!ids.length) return false;
  const targets = ids.map(id => b.fighters.find(f => f.id === id));
  const noSave = zone.spec.wall && phase !== 'initial';
  check(targets.every(f => alive(f) && (noSave || automaticSaveFailure(f, zone.spec.save) || f.saves?.[zone.spec.save] != null)), 'Uzupełnij rzut obronny celu strefy.');
  for (const id of ids) zone.triggered[triggerKey(zone, id, endTurn, phase)] = token(b);
  if (endTurn) b.fighters[b.turn].spellTurnEnded = b.round;
  b.pending = { kind: 'spell', actorId: targets[0].id, sourceId: zone.sourceId,
    zoneId: zone.id, zoneEvent: true, spellId: zone.spellId, spellName: zone.name,
    stage: noSave ? 'effect' : 'save', spec: { ...zone.spec, bonus: 0, ...(noSave ? { save: undefined, half: false } : {}) }, concentrationKey: zone.concentrationKey,
    dc: zone.dc, targets: ids.map(id => ({ id })) };
  return true;
}

export function dueZoneDamage(b, fighter) {
  return (b.spellZones ?? []).filter(z => !z.spec.noEndDamage && !z.needsPlacement && z.memberIds.includes(fighter.id) && eligibleZoneTargets(b, z, [fighter.id], true).length);
}

export function dueStartZoneEvents(b, fighter) {
  return (b.spellZones ?? []).flatMap(z => {
    if (z.needsPlacement || z.spec.binding !== 'web') return [];
    const events = [];
    if (z.startFireEligible && z.fires?.some(f => !f.expired && f.memberIds.includes(fighter.id)) && z.fireTriggered !== token(b)) events.push({ zone: z, fire: true });
    if (z.startMemberIds?.includes(fighter.id) && z.memberIds.includes(fighter.id) && eligibleZoneTargets(b, z, [fighter.id], false, 'start').length) events.push({ zone: z, fire: false });
    return events;
  });
}
export function beginStartZoneEvent(b, fighter, event = dueStartZoneEvents(b, fighter)[0]) {
  if (!event) return false;
  check(!b.pending && !b.suspendedAction, 'Najpierw rozlicz rozpoczęte działanie.');
  if (!event.fire) return beginZoneDamage(b, event.zone, [fighter.id], false, 'start');
  event.zone.fireTriggered = token(b);
  b.pending = { kind: 'spell', actorId: fighter.id, sourceId: event.zone.sourceId, zoneId: event.zone.id, zoneEvent: true,
    spellName: 'Web — ogień', spellId: 'web', stage: 'effect', spec: { mode: 'save', dice: 2, sides: 4, bonus: 0, type: 'Fire' }, targets: [{ id: fighter.id }] };
  return true;
}

export function handleSpellZone(context) {
  const { db, b, body, gm, log, canControl, activeMember } = context;
  if (!['zone-escape', 'zone-start', 'zone-free', 'zone-fire', 'zone-fire-members', 'zone-activate', 'zone-enter', 'zone-leave', 'zone-wall-enter', 'zone-wall-leave', 'zone-update', 'zone-move', 'zone-place', 'zone-end', 'zone-end-turn'].includes(body.kind)) return false;
  check(!b.pending && !b.suspendedAction && !b.fighters.some(f => f.concentrationDC), 'Najpierw rozstrzygnij rozpoczęte działanie i koncentrację.');
  const zone = b.spellZones?.find(z => z.id === body.zoneId);
  check(zone, 'Ta strefa już nie działa.');
  const current = b.fighters[b.turn];
  if (body.kind === 'zone-start') {
    check(gm || canControl(current) && activeMember(db, b.sessionId, current), 'Rozlicza właściciel celu lub MG.');
    const event = dueStartZoneEvents(b, current).find(e => e.zone.id === zone.id && e.fire === (body.fire === true));
    check(event && beginStartZoneEvent(b, current, event), 'Brak tego wyzwalacza początku tury.'); return true;
  }
  if (body.kind === 'zone-escape') {
    check(zone.spec.binding && zone.restrainedIds.includes(current.id) && current.characterId && canControl(current) && !current.action && !isIncapacitated(current), 'Uwolnienie wymaga własnej akcji Restrained postaci.');
    handleBarbarian({ ...context, body: { ...body, kind: 'ability-check', actorId: current.id, skill: 'athletics', ability: 'str', dc: zone.dc } });
    current.action = 'Uwolnienie z więzów';
    const success = current.lastAbilityCheck?.total >= zone.dc;
    if (success) zone.restrainedIds = zone.restrainedIds.filter(id => id !== current.id);
    log(b, `${current.name}: ${zone.name}, STR (Athletics) — ${success ? 'uwolniony' : 'porażka'}.`); return true;
  }
  if (body.kind === 'zone-activate') {
    const source = b.fighters.find(f => f.id === zone.sourceId), slot = zone.spec.moveSlot;
    check(source?.id === b.fighters[b.turn].id && canControl(source) && activeMember(db, b.sessionId, source) && !isIncapacitated(source) && source.spellTurnEnded !== b.round, 'Ruch strefy wymaga własnej aktywnej tury rzucającego.');
    check(slot && !source[slot] && !zone.moveReady && !zone.needsPlacement && (slot !== 'action' || zone.createdRound !== b.round), 'Brak działania do przesunięcia strefy lub trwa tura jej utworzenia.');
    source[slot] = `${zone.name}: przesunięcie`;
    zone.moveReady = token(b);
    log(b, `${source.name}: ${zone.name} — zużyto ${slot === 'action' ? 'akcję Magic' : 'akcję bonusową'} na przesunięcie do ${zone.spec.moveDistance} stóp. MG wskazuje pozycje.`);
    return true;
  }
  check(gm, 'Pozycje i wyzwalacze stref zatwierdza MG.');
  if (body.kind === 'zone-free') {
    check(zone.spec.binding && typeof body.note === 'string' && body.note.trim() && body.note.length <= 200, 'MG opisuje przyczynę uwolnienia.');
    zone.restrainedIds = zone.restrainedIds.filter(id => id !== body.targetId);
    log(b, `${zone.name}: MG uwalnia cel — ${body.note}.`); return true;
  }
  if (['zone-fire', 'zone-fire-members'].includes(body.kind)) {
    check(zone.spec.binding === 'web' && Array.isArray(body.memberIds) && new Set(body.memberIds).size === body.memberIds.length && body.memberIds.every(id => zone.memberIds.includes(id)), 'Wskaż cele w płonącym fragmencie Web.');
    if (body.kind === 'zone-fire-members') {
      const fire = zone.fires.find(f => f.id === body.fireId && !f.expired); check(fire, 'Ten fragment już się wypalił.'); fire.memberIds = body.memberIds;
    } else {
      check(typeof body.label === 'string' && body.label.trim() && body.label.length <= 80, 'Nazwij fragment 5-stopowego sześcianu wskazany przez MG.');
      zone.fires.push({ id: randomUUID(), label: body.label, memberIds: body.memberIds, endRound: b.round + 1, endTurnId: current.id, endInitiative: current.initiative });
    }
    log(b, `${zone.name}: MG zatwierdza płonący fragment 5 stóp i jego obsadę.`); return true;
  }
  if (body.kind === 'zone-end') {
    endConcentration(db, b.fighters.find(f => f.id === zone.sourceId));
    log(b, `${zone.name}: MG kończy strefę.`);
  } else if (['zone-move', 'zone-place', 'zone-update'].includes(body.kind)) {
    check(body.kind === 'zone-place' ? zone.needsPlacement : body.kind === 'zone-update' ? zone.spec.aura && !zone.needsPlacement : !zone.spec.stationary && !zone.needsPlacement && zone.sourceId === b.fighters[b.turn].id && (zone.spec.moveSlot ? zone.moveReady === token(b) : zone.lastMovedRound !== b.round), 'Najpierw aktywuj ruch strefy albo rozlicz automatyczny ruch na początku tury.');
    check(Array.isArray(body.memberIds) && new Set(body.memberIds).size === body.memberIds.length && body.memberIds.every(id => alive(b.fighters.find(f => f.id === id))), 'Wybierz obecne cele w chmurze.');
    check(Array.isArray(body.targetIds) && new Set(body.targetIds).size === body.targetIds.length && body.targetIds.every(id => alive(b.fighters.find(f => f.id === id))), 'Wybierz cele objęte przesunięciem lub wejściem.');
    if (zone.spec.separateCollision) check(body.targetIds.length <= (body.kind === 'zone-move' ? 1 : 0), 'Flaming Sphere zatrzymuje się na jednym celu; samo odtworzenie pozycji nie zadaje obrażeń.');
    if (zone.spec.wall) check(body.targetIds.length === 0, 'Odtworzenie pozycji ściany nie zadaje obrażeń; wskaż wejście w ścianę osobno.');
    zone.memberIds = body.memberIds;
    if (body.kind === 'zone-move') zone.lastMovedRound = b.round;
    zone.moveReady = null;
    zone.needsPlacement = false;
    if (body.kind === 'zone-place' && zone.spec.binding) { zone.startToken = token(b); zone.startMemberIds = body.memberIds.includes(current.id) ? [current.id] : []; }
    if (zone.spec.binding) check(body.targetIds.length === 0, 'Odtworzenie pozycji więzów nie ponawia początkowych rzutów.');
    else beginZoneDamage(b, zone, body.targetIds);
    log(b, `${zone.name}: MG ${body.kind === 'zone-move' ? `potwierdza przesunięcie do ${zone.spec.moveDistance ?? 10} stóp` : 'odtwarza położenie strefy'} i wskazuje cele.`);
  } else {
    const target = b.fighters.find(f => f.id === body.targetId);
    check(alive(target) && !zone.needsPlacement, 'Wybierz cel aktywnej strefy.');
    if (body.kind === 'zone-leave') { zone.memberIds = zone.memberIds.filter(id => id !== target.id); zone.wallIds = (zone.wallIds ?? []).filter(id => id !== target.id); }
    else if (['zone-wall-enter', 'zone-wall-leave'].includes(body.kind)) {
      check(zone.spec.wall, 'Ten czar nie jest ścianą ognia.');
      if (!zone.memberIds.includes(target.id)) zone.memberIds.push(target.id);
      zone.wallIds = (zone.wallIds ?? []).filter(id => id !== target.id);
      if (body.kind === 'zone-wall-enter') { zone.wallIds.push(target.id); beginZoneDamage(b, zone, [target.id]); }
    }
    else if (body.kind === 'zone-enter') {
      if (!zone.memberIds.includes(target.id)) zone.memberIds.push(target.id);
      if (!zone.spec.noEntryDamage) beginZoneDamage(b, zone, [target.id]);
    } else {
      check(target.id === b.fighters[b.turn].id && zone.memberIds.includes(target.id), 'Rozlicz koniec własnej tury w strefie.');
      check(beginZoneDamage(b, zone, [target.id], true), 'Ten cel już rozliczył ten czar w tej turze lub działa silniejsza strefa.');
    }
    const labels = { 'zone-leave': 'opuszczenie obszaru działania', 'zone-enter': 'wejście w obszar działania', 'zone-wall-enter': 'wejście w ścianę', 'zone-wall-leave': 'opuszczenie ściany, nadal w obszarze gorącej strony', 'zone-end-turn': 'koniec tury w strefie' };
    log(b, `${zone.name} → ${target.name}: ${labels[body.kind]}.`);
  }
  return true;
}
