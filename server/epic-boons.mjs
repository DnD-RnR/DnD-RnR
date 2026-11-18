import { resourceState, saveResources } from './spell-resources.mjs';
import { persistConditionState } from './conditions.mjs';
import { isIncapacitated } from '../shared/conditions.mjs';
import { frenzyDice } from '../shared/barbarian.mjs';
const check = (ok, message) => { if (!ok) throw new Error(message); };
const boon = (f, suffix) => f.epicBoons?.includes(`Boon of ${suffix}`);
export function handleEpicBoons({ db, b, body, canControl, activeMember, log }) {
  if (!body.kind?.startsWith('epic-')) return false;
  const f = b.fighters.find(t => t.id === (body.actorId ?? b.fighters[b.turn].id));
  check(f?.characterId && canControl(f) && activeMember(db, b.sessionId, f) && f.hp > 0 && !isIncapacitated(f), 'Nie możesz teraz użyć tego atutu.');
  const state = resourceState(db, f.characterId);
  if (body.kind === 'epic-prowess') {
    const r = b.lastRoll;
    check(boon(f, 'Combat Prowess') && !f.epicProwessUsed && (!b.pending || r?.kind === 'spell-attack' && b.pending.kind === 'spell' && b.pending.actorId === f.id && b.pending.castingId === r.pending.castingId) && ['attack', 'spell-attack'].includes(r?.kind) && r.actorId === f.id && !r.hit, 'Peerless Aim wymaga właśnie chybionego ataku i dostępnego użycia.');
    f.epicProwessUsed = true; r.hit = true;
    const pending = structuredClone(r.pending); pending.peerless = true;
    if (r.kind === 'spell-attack') { b.pending = pending; return true; }
    pending.frenzyDice = frenzyDice(b, f, pending.attack.ability); if (pending.frenzyDice) f.frenzyUsed = true;
    pending.divineFury = Boolean(f.rageProfile?.zealot && f.rage && !f.divineFuryUsed && b.fighters[b.turn].id === f.id); if (pending.divineFury) f.divineFuryUsed = true;
    b.pending = pending;
  } else if (body.kind === 'epic-blink') {
    check(boon(f, 'Dimensional Travel') && f.id === b.fighters[b.turn].id && !b.pending && f.epicBlinkReady && !f.attacksLeft && body.confirmed === true, 'Blink Steps: zakończ akcję Atak lub Magia i potwierdź widziane wolne pole w 30 stopach.');
    f.epicBlinkReady = false; log(b, `${f.name}: Blink Steps — teleportacja do 30 stóp.`);
  } else if (['epic-fate', 'epic-fate-manual'].includes(body.kind)) {
    const manual = body.kind === 'epic-fate-manual';
    check(!manual || Number.isInteger(body.originalTotal) && Math.abs(body.originalTotal) <= 999, 'Podaj potwierdzony przez MG wynik testu.');
    const r = manual ? { kind: 'manual', total: body.originalTotal } : b.lastRoll;
    check(boon(f, 'Fate') && !state.epicFateUsed && r && Number.isFinite(r.total) && body.confirmed === true && Array.isArray(body.rolls) && body.rolls.length === 2 && body.rolls.every(n => Number.isInteger(n) && n >= 1 && n <= 4) && [1, -1].includes(body.sign), 'Improve Fate: wybierz ostatni test w 60 stopach i podaj dwie k4 oraz znak.');
    state.epicFateUsed = true; const modifier = body.sign * body.rolls.reduce((a, n) => a + n, 0); r.total += modifier;
    if (r.kind === 'attack') {
      const attacker = b.fighters.find(t => t.id === r.actorId);
      const hit = r.natural === 20 || r.natural !== 1 && r.total >= r.dc;
      if (hit && !r.hit) {
        const pending = structuredClone(r.pending); pending.frenzyDice = frenzyDice(b, attacker, pending.attack.ability); if (pending.frenzyDice) attacker.frenzyUsed = true;
        pending.divineFury = Boolean(attacker.rageProfile?.zealot && attacker.rage && !attacker.divineFuryUsed && b.fighters[b.turn].id === attacker.id); if (pending.divineFury) attacker.divineFuryUsed = true;
        b.pending = pending;
      } else if (!hit && r.hit) { if (b.pending?.frenzyDice) attacker.frenzyUsed = false; if (b.pending?.divineFury) attacker.divineFuryUsed = false; b.pending = null; }
      r.hit = hit;
    } else if (r.kind === 'spell-attack') {
      const hit = r.natural === 20 || r.natural !== 1 && r.total >= r.dc;
      if (hit && !r.hit) b.pending = { ...structuredClone(r.pending), attackTotal: r.total };
      else if (!hit && r.hit) {
        const missed = structuredClone(r.pending);
        if (missed.spec.missHalf) { missed.missed = true; missed.targets[0].saved = true; missed.critical = false; missed.hexDice = 0; b.pending = missed; }
        else if (missed.remainingTargets?.length) { missed.targets = [{ id: missed.remainingTargets.shift() }]; missed.stage = 'attack'; b.pending = missed; }
        else b.pending = null;
      }
      r.hit = hit;
    } else if (r.kind === 'spell-save') {
      const p = b.pending ?? structuredClone(r.pending);
      check(p?.kind === 'spell', 'Ten rzut został już rozstrzygnięty.');
      const t = p.targets.find(t => t.id === r.targetId); t.saved = r.total >= r.dc; if (t.saved && p.fanaticalTargetId === t.id) delete p.fanaticalTargetId;
      if (p.targets.every(t => t.saved !== undefined)) p.stage = 'effect';
      b.pending = p;
    }
    log(b, `${f.name}: Improve Fate ${modifier >= 0 ? '+' : ''}${modifier}; nowy wynik testu: ${r.total}.`);
  } else if (body.kind === 'epic-light') {
    check(boon(f, 'the Night Spirit') && !b.pending && body.confirmed === true && typeof body.dim === 'boolean', 'Potwierdź z MG słabe światło lub ciemność.');
    f.epicDim = body.dim;
    if (!f.epicDim) endEpicInvisible(db, f);
  } else if (body.kind === 'epic-shadows') {
    check(boon(f, 'the Night Spirit') && f.epicDim && f.id === b.fighters[b.turn].id && !b.pending && !f.bonus, 'Merge with Shadows wymaga akcji dodatkowej w słabym świetle lub ciemności.');
    f.bonus = 'Merge with Shadows'; f.epicNightInvisible = true;
    f.conditionSources ??= []; f.conditionSources = f.conditionSources.filter(e => e.id !== `epic-night:${f.id}`);
    f.conditionSources.push({ id: `epic-night:${f.id}`, kind: 'invisible', sourceId: f.id, sourceName: 'Merge with Shadows' }); persistConditionState(db, f);
  } else throw new Error('Nieznany Epic Boon.');
  // Condition writes can change the resource row; retain those changes.
  const latest = resourceState(db, f.characterId); if (['epic-fate', 'epic-fate-manual'].includes(body.kind)) latest.epicFateUsed = true; saveResources(db, f.characterId, latest);
  return true;
}
export function endEpicInvisible(db, f) {
  if (!f.epicNightInvisible) return;
  f.conditionSources = (f.conditionSources ?? []).filter(e => e.id !== `epic-night:${f.id}`); f.epicNightInvisible = false; persistConditionState(db, f);
}
