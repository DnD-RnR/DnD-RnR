import { randomUUID } from 'node:crypto';
import { resourceState, saveResources } from './spell-resources.mjs';
import { timedHpBonus, timedSpellDefinitions } from '../shared/timed-effects.mjs';
import { endConcentration } from './concentration.mjs';
import { isIncapacitated } from '../shared/conditions.mjs';

export function effectActive(db, effect, b = null) {
  if (effect.endRound == null && effect.remainingSeconds == null) { /* An instantaneous spell can impose an indefinite condition. */ }
  else if (b && effect.battleStartedAt === b.startedAt && effect.sessionId === b.sessionId) {
    const sourceIndex = b.fighters.findIndex(f => f.characterId === effect.sourceCharacterId);
    if (b.round > effect.endRound || b.round === effect.endRound && (sourceIndex < 0 ? b.fighters[b.turn].initiative < effect.sourceInitiative : effect.endPhase === 'end' ? b.turn > sourceIndex : b.turn >= sourceIndex)) return false;
  } else if ((effect.remainingSeconds ?? Math.ceil((effect.expiresAt - Date.now()) / 1000)) <= 0) return false;
  if (!effect.concentrationKey) return true;
  const source = b?.fighters.find(f => f.characterId === effect.sourceCharacterId);
  if (source) return Boolean(source.concentration && source.hp > 0 && !isIncapacitated(source) && source.concentrationKey === effect.concentrationKey);
  const state = resourceState(db, effect.sourceCharacterId);
  return Boolean(state.concentration && state.concentrationKey === effect.concentrationKey);
}
export function characterTimedEffects(db, id, b = null) {
  const state = resourceState(db, id);
  if (!state.activeEffects?.length && !state.activeHpBonus) return [];
  if (!b) b = db.prepare('SELECT data FROM session_battles').all().map(row => JSON.parse(row.data)).find(battle => battle.active && battle.fighters.some(f => f.characterId === id)) ?? null;
  const wearingArmor = (state.activeEffects ?? []).some(e => e.modifiers.mageArmor) && Boolean(db.prepare("SELECT 1 FROM character_items i JOIN armor_catalog a ON a.id = i.armor_id WHERE i.character_id = ? AND i.equipped = 1 AND a.category != 'shield'").get(id));
  const effects = (state.activeEffects ?? []).filter(e => !(wearingArmor && e.modifiers.mageArmor) && effectActive(db, e, b));
  const hpBonus = timedHpBonus(effects), delta = hpBonus - (state.activeHpBonus ?? 0);
  if (effects.length !== (state.activeEffects ?? []).length || delta) {
    if (delta) {
      const row = db.prepare('SELECT data FROM character_statistics WHERE character_id = ?').get(id);
      if (row) {
        const stats = JSON.parse(row.data);
        if (stats.values.hp != null) {
          stats.values.hp = Math.max(0, stats.values.hp + delta);
          if (stats.values.hp === 0) { state.concentration = null; state.concentrationKey = null; state.concentrationRemainingSeconds = null; }
        }
        db.prepare('UPDATE character_statistics SET data = ? WHERE character_id = ?').run(JSON.stringify(stats), id);
      }
    }
    state.activeEffects = effects; state.activeHpBonus = hpBonus; saveResources(db, id, state);
  }
  return effects;
}
export function bindTimedEffects(db, b) {
  for (const f of b.fighters.filter(f => f.characterId)) {
    const state = resourceState(db, f.characterId);
    for (const e of state.activeEffects ?? []) {
      delete e.lastSaveRound;
      if (e.remainingSeconds == null && e.endRound == null) { e.sessionId = b.sessionId; e.battleStartedAt = b.startedAt; continue; }
      e.endRound = b.round + Math.max(1, Math.ceil((e.remainingSeconds ?? (e.expiresAt - Date.now()) / 1000) / 6));
      e.sessionId = b.sessionId; e.battleStartedAt = b.startedAt;
    }
    if (state.activeEffects?.length) saveResources(db, f.characterId, state);
    if (f.concentration && state.concentrationRemainingSeconds != null) f.concentrationExpiresRound = b.round + Math.max(1, Math.ceil(state.concentrationRemainingSeconds / 6));
  }
}
export function applyTimedEffect(db, b, source, target, spell, level, castingId, options = {}) {
  const definition = timedSpellDefinitions[spell.id];
  if (definition.concentration && (!source.concentration || !source.concentrationKey)) return false;
  const modifiers = { ...definition };
  if (definition.conditionOptions) modifiers.condition = options.condition;
  let seconds = definition.seconds, endPhase = definition.endPhase;
  if (definition.hpThreshold != null && target.hp > definition.hpThreshold) {
    modifiers.condition = null; modifiers.repeatSave = null; modifiers.speedZero = true; seconds = 6; endPhase = 'start';
  }
  if (definition.hpBonus) modifiers.hpBonus += (level - spell.level) * (definition.hpPerLevel ?? 0);
  const effect = { id: randomUUID(), castingId, spellId: spell.id, name: spell.name, dismissible: definition.dismissible !== false, sourceName: source.name, sourceCharacterId: source.characterId, sourceFighterId: source.id, sourceInitiative: source.initiative, concentrationKey: definition.concentration ? source.concentrationKey : null, level, potency: modifiers.hpBonus ?? 0, modifiers, dc: options.dc, createdAt: Date.now(), remainingSeconds: seconds, expiresAt: seconds == null ? null : Date.now() + seconds * 1000, sessionId: b.sessionId, battleStartedAt: b.startedAt, endRound: seconds == null ? null : b.round + seconds / 6, endPhase };
  if (target.characterId) {
    const state = resourceState(db, target.characterId); state.activeEffects = [...(state.activeEffects ?? []), effect]; saveResources(db, target.characterId, state);
  } else target.timedEffects = [...(target.timedEffects ?? []), effect];
}
export function syncTimedEffects(db, b, persistVitals, settling = false) {
  let lostConcentration = false;
  for (const f of b.fighters) {
    const effects = f.characterId ? characterTimedEffects(db, f.characterId, b) : (f.timedEffects ?? []).filter(e => effectActive(db, e, b));
    const bonus = timedHpBonus(effects), delta = bonus - (f.appliedTimedHpBonus ?? 0);
    if (delta) {
      f.maxHp += delta; f.hp = Math.max(0, f.hp + delta);
      if (f.hp === 0 && f.concentration) { endConcentration(db, f); lostConcentration = true; }
      if (persistVitals) persistVitals(db, f);
    }
    f.appliedTimedHpBonus = bonus; f.timedEffects = effects;
  }
  if (lostConcentration && !settling) syncTimedEffects(db, b, persistVitals, true);
}
export function releaseTimedEffects(db, b) {
  for (const f of b.fighters.filter(f => f.characterId)) {
    const state = resourceState(db, f.characterId);
    let changed = false;
    if (f.concentration && state.concentrationKey === f.concentrationKey && f.concentrationExpiresRound != null) {
      const partialRound = f.concentrationExpiresRound === b.round && b.turn < b.fighters.indexOf(f) ? 1 : 0;
      state.concentrationRemainingSeconds = Math.max(partialRound, f.concentrationExpiresRound - b.round) * 6; changed = true;
    }
    for (const e of state.activeEffects ?? []) {
      if (e.battleStartedAt !== b.startedAt || e.sessionId !== b.sessionId) continue;
      if (e.endRound == null) { e.battleStartedAt = null; changed = true; continue; }
      const sourceIndex = b.fighters.findIndex(source => source.characterId === e.sourceCharacterId);
      const partialRound = e.endRound === b.round && sourceIndex >= 0 && (e.endPhase === 'end' ? b.turn <= sourceIndex : b.turn < sourceIndex) ? 1 : 0;
      e.remainingSeconds = Math.max(partialRound, e.endRound - b.round) * 6;
      e.expiresAt = Date.now() + e.remainingSeconds * 1000;
      e.battleStartedAt = null; changed = true;
    }
    if (changed) saveResources(db, f.characterId, state);
  }
}
export function advanceEffectTime(db, ids, seconds) {
  for (const id of ids) {
    const state = resourceState(db, id);
    for (const effect of state.activeEffects ?? []) if (!(effect.remainingSeconds == null && effect.endRound == null)) effect.remainingSeconds = Math.max(0, (effect.remainingSeconds ?? (effect.expiresAt - Date.now()) / 1000) - seconds);
    if (state.concentrationRemainingSeconds != null) {
      state.concentrationRemainingSeconds = Math.max(0, state.concentrationRemainingSeconds - seconds);
      if (!state.concentrationRemainingSeconds) { state.concentration = null; state.concentrationKey = null; }
    }
    saveResources(db, id, state);
  }
  for (const id of ids) characterTimedEffects(db, id);
}
export function dismissTimedEffect(db, b, source, castingId) {
  const currentKey = resourceState(db, source.characterId).concentrationKey;
  let concentrationDismissed = false;
  const rows = db.prepare('SELECT character_id, data FROM character_spell_resources').all().map(row => ({ ...row, state: JSON.parse(row.data) }));
  const selected = [...rows.flatMap(row => row.state.activeEffects ?? []), ...b.fighters.flatMap(f => f.characterId ? [] : f.timedEffects ?? [])].filter(e => e.sourceCharacterId === source.characterId && e.castingId === castingId);
  if (selected.some(e => e.dismissible === false)) return false;
  for (const row of rows) {
    const state = row.state, before = state.activeEffects ?? [];
    const effects = before.filter(e => {
      const remove = e.sourceCharacterId === source.characterId && e.castingId === castingId;
      if (remove && e.concentrationKey && e.concentrationKey === currentKey) concentrationDismissed = true;
      return !remove;
    });
    if (effects.length !== before.length) { state.activeEffects = effects; saveResources(db, row.character_id, state); }
  }
  for (const f of b.fighters) if (!f.characterId) f.timedEffects = (f.timedEffects ?? []).filter(e => {
    const remove = e.sourceCharacterId === source.characterId && e.castingId === castingId;
    if (remove && e.concentrationKey && e.concentrationKey === currentKey) concentrationDismissed = true;
    return !remove;
  });
  if (concentrationDismissed) endConcentration(db, source);
  return true;
}
