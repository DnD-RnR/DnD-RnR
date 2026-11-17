import { randomUUID } from 'node:crypto';
import { takeDeathWard } from './death-ward.mjs';
import { resourceState, saveResources } from './spell-resources.mjs';
import { timedHpBonus, timedSpellDefinitions } from '../shared/timed-effects.mjs';
import { endConcentration } from './concentration.mjs';
import { isIncapacitated } from '../shared/conditions.mjs';

export function hasteLethargy(b, target, seconds = 6) {
  if (!Number.isInteger(b?.round) || !target.id) b = null;
  const index = b?.fighters.findIndex(f => f.id === target.id) ?? -1;
  return { id: randomUUID(), castingId: randomUUID(), spellId: 'haste-lethargy', name: 'Haste — letarg', dismissible: false,
    sourceCharacterId: target.characterId, sourceFighterId: target.id, sourceInitiative: target.initiative,
    modifiers: { condition: 'incapacitated', speedZero: true }, createdAt: Date.now(), remainingSeconds: seconds,
    expiresAt: Date.now() + seconds * 1000, sessionId: b?.sessionId, battleStartedAt: b?.startedAt,
    endRound: b ? b.round + (index <= b.turn ? 1 : 0) : null, endPhase: 'end', nextTargetTurn: true };
}

export function effectActive(db, effect, b = null) {
  if (effect.modifiers.armorOfAgathys) {
    const target = b?.fighters.find(f => f.id === effect.sourceFighterId || f.characterId && f.characterId === effect.sourceCharacterId);
    const tempHp = target ? target.tempHp : effect.sourceCharacterId ? JSON.parse(db.prepare('SELECT data FROM character_statistics WHERE character_id = ?').get(effect.sourceCharacterId)?.data ?? '{}').values?.tempHp : 0;
    if (!(tempHp > 0)) return false;
  }
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
  if (state.activeEffects?.some(e => e.spellId === 'haste') && !effects.some(e => e.spellId === 'haste')) {
    if (state.hasteLethargySeconds !== 0) effects.push(hasteLethargy(b, b?.fighters.find(f => f.characterId === id) ?? { characterId: id }, state.hasteLethargySeconds ?? 6));
    delete state.hasteLethargySeconds;
  }
  let concentrationCleared = false;
  if (state.concentration && isIncapacitated({ timedEffects: effects })) {
    state.concentration = null; state.concentrationKey = null; state.concentrationRemainingSeconds = null;
    concentrationCleared = true;
  }
  const hpBonus = timedHpBonus(effects), delta = hpBonus - (state.activeHpBonus ?? 0);
  if (concentrationCleared || effects.length !== (state.activeEffects ?? []).length || effects.some(e => !state.activeEffects?.some(old => old.id === e.id)) || state.activeEffects?.some(e => !effects.some(now => now.id === e.id)) || delta) {
    if (delta) {
      const row = db.prepare('SELECT data FROM character_statistics WHERE character_id = ?').get(id);
      if (row) {
        const stats = JSON.parse(row.data);
        if (stats.values.hp != null) {
          const hpBefore = stats.values.hp;
          stats.values.hp = Math.max(0, stats.values.hp + delta);
          if (hpBefore > 0 && stats.values.hp === 0 && takeDeathWard(effects)) stats.values.hp = 1;
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
      e.endRound = e.nextTargetTurn ? b.round : b.round + Math.max(1, Math.ceil((e.remainingSeconds ?? (e.expiresAt - Date.now()) / 1000) / 6));
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
  if (definition.armorOfAgathys) {
    modifiers.retaliationAmount = 5 * level; modifiers.retaliationType = options.damageType ?? 'Cold';
    const row = target.characterId ? db.prepare('SELECT data FROM character_statistics WHERE character_id = ?').get(target.characterId) : null;
    const stats = row ? JSON.parse(row.data) : null;
    target.tempHp = Math.max(target.tempHp ?? stats?.values.tempHp ?? 0, 5 * level);
    if (stats) { stats.values.tempHp = target.tempHp; db.prepare('UPDATE character_statistics SET data = ? WHERE character_id = ?').run(JSON.stringify(stats), target.characterId); }
  }
  if (definition.fireShield) {
    if (!definition.effectOptions.includes(options.effectChoice)) throw new Error('Wybierz ciepłą albo zimną tarczę.');
    modifiers.retaliationType = options.damageType ?? (options.effectChoice === 'warm' ? 'Fire' : 'Cold');
    modifiers.resistances = [options.effectChoice === 'warm' ? 'zimno' : 'ogień'];
  }
  if (definition.sizeChange) {
    if (!definition.effectOptions.includes(options.effectChoice)) throw new Error('Wybierz Enlarge albo Reduce.');
    modifiers.sizeDelta = options.effectChoice === 'enlarge' ? 1 : -1;
    modifiers.strAdvantage = modifiers.sizeDelta > 0; modifiers.strDisadvantage = modifiers.sizeDelta < 0;
  }
  if (definition.conditionOptions) modifiers.condition = options.condition;
  let seconds = definition.seconds, endPhase = definition.endPhase;
  if (definition.hpThreshold != null && target.hp > definition.hpThreshold) {
    modifiers.condition = null; modifiers.repeatSave = null; modifiers.speedZero = true; seconds = 6; endPhase = 'start';
  }
  if (definition.hpBonus) modifiers.hpBonus += (level - spell.level) * (definition.hpPerLevel ?? 0);
  const effect = { id: randomUUID(), castingId, spellId: spell.id, name: spell.name, dismissible: definition.dismissible !== false, sourceName: source.name, sourceCharacterId: source.characterId, sourceFighterId: source.id, sourceInitiative: source.initiative, concentrationKey: definition.concentration ? source.concentrationKey : null, level, potency: modifiers.hpBonus ?? modifiers.retaliationAmount ?? 0, modifiers, dc: options.dc, createdAt: Date.now(), remainingSeconds: seconds, expiresAt: seconds == null ? null : Date.now() + seconds * 1000, sessionId: b.sessionId, battleStartedAt: b.startedAt, endRound: seconds == null ? null : b.round + seconds / 6, endPhase };
  if (target.characterId) {
    const state = resourceState(db, target.characterId); state.activeEffects = [...(state.activeEffects ?? []), effect]; saveResources(db, target.characterId, state);
  } else target.timedEffects = [...(target.timedEffects ?? []), effect];
}
export function syncTimedEffects(db, b, persistVitals, settling = false) {
  let lostConcentration = false;
  for (const f of b.fighters) {
    const effects = f.characterId ? characterTimedEffects(db, f.characterId, b) : (f.timedEffects ?? []).filter(e => effectActive(db, e, b));
    if (f.aloft && f.timedEffects?.some(e => e.spellId === 'fly') && !effects.some(e => e.spellId === 'fly')) f.flightNeedsReview = true;
    if (!f.characterId && f.timedEffects?.some(e => e.spellId === 'haste') && !effects.some(e => e.spellId === 'haste')) effects.push(hasteLethargy(b, f));
    const bonus = timedHpBonus(effects), delta = bonus - (f.appliedTimedHpBonus ?? 0);
    if (delta) {
      const hpBefore = f.hp;
      f.maxHp += delta; f.hp = Math.max(0, f.hp + delta);
      if (f.hp === 0 && f.characterId) {
        const saved = JSON.parse(db.prepare('SELECT data FROM character_statistics WHERE character_id = ?').get(f.characterId)?.data ?? '{}');
        f.hp = saved.values?.hp ?? 0;
      } else if (hpBefore > 0 && f.hp === 0 && delta < 0 && takeDeathWard(effects)) f.hp = 1;
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
  const hasteAtStart = new Map(ids.map(id => {
    const effects = (resourceState(db, id).activeEffects ?? []).filter(e => e.spellId === 'haste');
    return [id, effects.length ? Math.max(0, ...effects.filter(e => effectActive(db, e)).map(e => e.remainingSeconds ?? 60)) : null];
  }));
  for (const id of ids) {
    const state = resourceState(db, id);
    const haste = (state.activeEffects ?? []).filter(e => e.spellId === 'haste');
    if (haste.length) state.hasteLethargySeconds = Math.max(0, 6 - Math.max(0, seconds - hasteAtStart.get(id)));
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
  if (!selected.length) return false;
  if (selected.some(e => e.dismissible === false)) return false;
  for (const row of rows) {
    const state = row.state, before = state.activeEffects ?? [];
    const effects = before.filter(e => {
      const remove = e.sourceCharacterId === source.characterId && e.castingId === castingId;
      if (remove && e.concentrationKey && e.concentrationKey === currentKey) concentrationDismissed = true;
      return !remove;
    });
    if (effects.length !== before.length) {
      if (before.some(e => e.spellId === 'haste') && !effects.some(e => e.spellId === 'haste')) effects.push(hasteLethargy(b, b.fighters.find(f => f.characterId === row.character_id) ?? { characterId: row.character_id }));
      state.activeEffects = effects; saveResources(db, row.character_id, state);
    }
  }
  for (const f of b.fighters) if (!f.characterId) {
    const hadHaste = f.timedEffects?.some(e => e.spellId === 'haste');
    f.timedEffects = (f.timedEffects ?? []).filter(e => {
      const remove = e.sourceCharacterId === source.characterId && e.castingId === castingId;
      if (remove && e.concentrationKey && e.concentrationKey === currentKey) concentrationDismissed = true;
      return !remove;
    });
    if (hadHaste && !f.timedEffects.some(e => e.spellId === 'haste')) f.timedEffects.push(hasteLethargy(b, f));
  }
  if (concentrationDismissed) endConcentration(db, source);
  return true;
}
