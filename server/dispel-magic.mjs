import { spellById } from '../shared/spellcasting.mjs';
import { exhaustionPenalty, conditionCheckDisadvantage } from '../shared/conditions.mjs';
import { hexActive } from '../shared/warlock.mjs';
import { resourceState, saveResources } from './spell-resources.mjs';
import { hasteLethargy } from './timed-effects.mjs';
import { endConcentration } from './concentration.mjs';
import { luckBonus } from './warlock-features.mjs';

const check = (ok, message) => { if (!ok) throw new Error(message); };
const ongoing = id => {
  const spell = spellById.get(id);
  return spell && !/instantaneous|natychmiast/i.test(spell.duration);
};
// A creature target removes only effects on that creature, not other recipients.
function effectsOn(b, target) {
  const effects = (target.timedEffects ?? []).filter(e => ongoing(e.spellId))
    .map(e => ({ key: `timed:${e.id}`, kind: 'timed', id: e.id, spellId: e.spellId, name: e.name, level: e.level }));
  for (const source of b.fighters) if (hexActive(source, target)) effects.push({ key: `hex:${source.id}`, kind: 'hex', sourceId: source.id, name: 'Hex', level: source.hex.level ?? 1 });
  if (target.shieldAC) effects.push({ key: `shield:${target.id}`, kind: 'shield', name: 'Shield', level: target.shieldLevel ?? 1 });
  for (const [index, e] of (target.spellConditions ?? []).entries()) if (e.castingId && e.spellId && ongoing(e.spellId)) effects.push({ key: `condition:${index}`, kind: 'condition', index, name: spellById.get(e.spellId).name, level: e.level, castingId: e.castingId });
  for (const e of b.repeatSpells ?? []) if (e.spellId === 'witch-bolt' && e.targetId === target.id) effects.push({ key: `repeat:${e.id}`, kind: 'repeat', sourceId: e.sourceId, name: e.name, level: e.level ?? 1 });
  return effects;
}
function removeEffect(db, b, target, effect) {
  if (effect.kind === 'timed') {
    const remove = list => list.filter(e => e.id !== effect.id);
    const old = target.timedEffects ?? [];
    target.timedEffects = remove(old);
    if (old.some(e => e.id === effect.id && e.spellId === 'haste') && !target.timedEffects.some(e => e.spellId === 'haste')) target.timedEffects.push(hasteLethargy(b, target));
    if (target.characterId) {
      const state = resourceState(db, target.characterId);
      state.activeEffects = remove(state.activeEffects ?? []);
      // Keep the aftermath even though the original effect has been removed.
      if (target.timedEffects.some(e => e.spellId === 'haste-lethargy') && !state.activeEffects.some(e => e.spellId === 'haste-lethargy')) state.activeEffects.push(target.timedEffects.find(e => e.spellId === 'haste-lethargy'));
      saveResources(db, target.characterId, state);
    }
    const removed = old.find(e => e.id === effect.id);
    if (removed?.concentrationKey) {
      const key = removed.concentrationKey;
      const remaining = b.fighters.some(f => (f.characterId ? [] : f.timedEffects ?? []).some(e => e.concentrationKey === key) || f.spellConditions?.some(e => e.concentrationKey === key)) || db.prepare('SELECT data FROM character_spell_resources').all().some(row => JSON.parse(row.data).activeEffects?.some(e => e.concentrationKey === key));
      if (!remaining) {
        const source = b.fighters.find(f => f.id === removed.sourceFighterId || f.characterId && f.characterId === removed.sourceCharacterId);
        if (source?.concentrationKey === key) endConcentration(db, source);
        else if (!source && removed.sourceCharacterId && resourceState(db, removed.sourceCharacterId).concentrationKey === key) endConcentration(db, { characterId: removed.sourceCharacterId });
      }
    }
  } else if (effect.kind === 'shield') {
    target.ac -= target.shieldAC; target.shieldAC = 0;
  } else if (effect.kind === 'condition') {
    target.spellConditions = (target.spellConditions ?? []).filter(e => e.castingId !== effect.castingId);
  } else if (effect.kind === 'hex') {
    const source = b.fighters.find(f => f.id === effect.sourceId);
    source.hex = null;
    if (source.characterId) { const state = resourceState(db, source.characterId); state.hex = null; saveResources(db, source.characterId, state); }
    endConcentration(db, source);
  } else if (effect.kind === 'repeat' || effect.kind === 'zone') {
    const source = b.fighters.find(f => f.id === effect.sourceId);
    if (source) endConcentration(db, source);
  }
}
function advance(db, b, log) {
  const p = b.pending;
  while (p.effects.length && p.effects[0].level <= p.level) {
    const e = p.effects.shift(); removeEffect(db, b, b.fighters.find(f => f.id === p.targetId), e);
    log(b, `Dispel Magic: ${e.name} — rozproszony bez testu (${e.level}. krąg).`);
  }
  if (!p.effects.length) b.pending = null;
}
export function beginDispel(db, b, caster, cast, body, log) {
  check(cast.ability != null, 'Uzupełnij cechę czarowania.');
  const zone = body.dispelZoneId && b.spellZones?.find(z => z.id === body.dispelZoneId);
  const target = b.fighters.find(f => f.id === body.targetIds?.[0]);
  check(zone ? !body.targetIds?.length : target && body.targetIds.length === 1, 'Dispel Magic: wybierz jedno stworzenie albo jedną strefę magiczną.');
  const effects = zone ? [{ key: `zone:${zone.id}`, kind: 'zone', sourceId: zone.sourceId, name: zone.name, level: zone.level }] : effectsOn(b, target);
  check(effects.every(e => Number.isInteger(e.level)), 'Brak kręgu istniejącego efektu; ten starszy zapis rozstrzyga MG.');
  b.pending = { kind: 'dispel', actorId: caster.id, targetId: target?.id, level: body.level, ability: cast.ability, spellcastingAbility: cast.spell.spellcastingAbility ?? cast.profile.ability, effects };
  if (!effects.length) log(b, 'Dispel Magic: brak zapisanych trwających czarów na celu. Efekty opisowe i przedmioty rozstrzyga MG.');
  advance(db, b, log);
}
export function resolveDispel({ db, b, body, canControl, activeMember, log }) {
  if (body.kind !== 'dispel-check') return false;
  const p = b.pending, caster = b.fighters.find(f => f.id === p?.actorId);
  check(p?.kind === 'dispel' && caster && canControl(caster) && activeMember(db, b.sessionId, caster), 'Brak twojego testu rozpraszania.');
  const e = p.effects[0];
  const disadvantage = body.disadvantage || conditionCheckDisadvantage(caster, p.spellcastingAbility) || (caster.spellConditions ?? []).some(c => c.kind === 'enfeebled' && p.spellcastingAbility === 'str') || b.fighters.some(f => hexActive(f, caster) && f.hex.ability === p.spellcastingAbility);
  const advantage = Boolean(body.advantage);
  const die = n => Number.isInteger(n) && n >= 1 && n <= 20;
  check(die(body.roll) && (advantage === Boolean(disadvantage) || die(body.roll2)), 'Podaj k20 i drugą kość przy ułatwieniu/utrudnieniu.');
  const roll = advantage === Boolean(disadvantage) ? body.roll : advantage ? Math.max(body.roll, body.roll2) : Math.min(body.roll, body.roll2);
  const total = roll + p.ability - exhaustionPenalty(caster) + (caster.characterId ? luckBonus(db, caster.characterId, body.luckRoll) : 0);
  const success = total >= 10 + e.level;
  if (success) removeEffect(db, b, b.fighters.find(f => f.id === p.targetId), e);
  log(b, `Dispel Magic: ${e.name}, test ${total} przeciw ST ${10 + e.level} — ${success ? 'rozproszony' : 'trwa'}.`);
  p.effects.shift(); advance(db, b, log);
  return true;
}
