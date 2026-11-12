import { spellcastingProfile } from '../shared/spellcasting.mjs';
import { invocationCount, invocationOptions } from '../shared/warlock-invocations.mjs';
import { fiendProfile } from '../shared/warlock.mjs';
import { randomUUID } from 'node:crypto';

const check = (ok, message) => { if (!ok) throw new Error(message); };
const blessingFor = (db, fighter) => {
  if (!fighter.characterId) return { enabled: false };
  const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(fighter.characterId);
  const row = db.prepare('SELECT data FROM character_statistics WHERE character_id = ?').get(fighter.characterId);
  return fiendProfile(character, row ? JSON.parse(row.data).values?.cha : null);
};
const grantBlessing = (db, fighter, amount, persistVitals, log, b) => {
  check(amount !== null, 'Uzupełnij Charyzmę warlocka.');
  fighter.tempHp = Math.max(fighter.tempHp ?? 0, amount);
  persistVitals(db, fighter);
  log(b, `${fighter.name}: Dark One's Blessing — ${amount} tymczasowych PW (łącznie ${fighter.tempHp}).`);
};

// Record actual positive-HP -> zero-HP transitions before defeated monsters leave initiative.
export function recordFiendDefeats({ db, b, before, sourceId, activeMember, persistVitals, log }) {
  for (const target of b.fighters) {
    if (target.hp > 0) { delete target.fiendDefeatPending; continue; }
    if (!(before.get(target.id) > 0 || target.fiendDefeatPending)) continue;
    const defeatSource = target.fiendDefeatPending?.sourceId ?? sourceId;
    if (target.relentlessRagePending) { target.fiendDefeatPending = { sourceId: defeatSource }; continue; }
    delete target.fiendDefeatPending;
    const candidates = b.fighters.filter(f => f.id !== target.id && activeMember(db, b.sessionId, f) && blessingFor(db, f).enabled);
    if (!candidates.length) continue;
    const event = { id: randomUUID(), targetId: target.id, targetName: target.name, sourceId: defeatSource, candidates: candidates.map(f => f.id), granted: [] };
    for (const fighter of candidates) {
      const profile = blessingFor(db, fighter);
      if (!target.characterId && defeatSource === fighter.id && profile.temporaryHitPoints !== null) {
        grantBlessing(db, fighter, profile.temporaryHitPoints, persistVitals, log, b);
        event.granted.push(fighter.id);
      }
    }
    b.fiendDefeats = [...(b.fiendDefeats ?? []), event].slice(-100);
  }
}

export function handleFiend({ db, b, body, gm, activeMember, persistVitals, log }) {
  if (body.kind !== 'dark-ones-blessing') return false;
  check(gm, 'GM potwierdza wroga i odległość dla Dark One’s Blessing.');
  const event = b.fiendDefeats?.find(e => e.id === body.eventId);
  const fighter = b.fighters.find(f => f.id === body.actorId);
  check(event && fighter && event.candidates.includes(fighter.id) && !event.granted.includes(fighter.id), 'Brak nierozliczonego zdarzenia dla tej postaci.');
  check(activeMember(db, b.sessionId, fighter) && body.enemy === true, 'Potwierdź, że pokonana istota była wrogiem warlocka.');
  check(event.sourceId === fighter.id || body.within10Feet === true, 'Potwierdź odległość najwyżej 10 stóp od pokonanego wroga.');
  const profile = blessingFor(db, fighter);
  check(profile.enabled, 'Wymagany Fiend Patron i 3. poziom warlocka.');
  grantBlessing(db, fighter, profile.temporaryHitPoints, persistVitals, log, b);
  event.granted.push(fighter.id);
  return true;
}

export function invocationUpdate(character, stats, stored, explicit = true) {
  if (!invocationCount(character)) return {};
  const selected = stats.traits?.invocations ?? [];
  const previous = stored?.invocationProgression;
  const old = previous?.selections ?? stored?.traits?.invocations ?? [];
  const baseline = previous ?? (old.length ? { level: character.level, selections: old, remaining: 0 } : null);
  if (!explicit) return { history: baseline };
  if (selected.length !== invocationCount(character)) return { error: `Eldritch Invocations: wybierz dokładnie ${invocationCount(character)} inwokacji.` };
  const available = new Set(invocationOptions(character, stats).map(i => i.id));
  if (new Set(selected).size !== selected.length || selected.some(id => !available.has(id))) {
    return { error: 'Eldritch Invocations: niespełnione wymagania poziomu, inwokacji lub wybranego czaru; powtórzenia muszą dotyczyć różnych czarów lub atutów.' };
  }
  if (baseline && character.level < baseline.level) return { error: 'Eldritch Invocations: przywróć zapisany poziom postaci przed zmianą inwokacji.' };
  const gained = baseline ? Math.max(0, character.level - baseline.level) : 0;
  const remaining = baseline ? gained || baseline.remaining : 0;
  const removed = old.filter(id => !selected.includes(id)).length;
  if (removed > remaining) return { error: `Eldritch Invocations: pozostało ${remaining} wymian przy awansie. Nie możesz wymieniać inwokacji bez awansu.` };
  return { history: { level: character.level, selections: [...selected], remaining: remaining - removed } };
}

// This state is owned by the server; never accept progression from the request.
export function pactMagicUpdate(character, spells, stored, traits, explicit = true) {
  if (!character.class?.includes('(Warlock)')) return {};
  const previous = stored?.pactMagicProgression;
  const old = previous?.selections ?? stored?.spells?.selections ?? {};
  const hasChoices = ['cantrips', 'prepared'].some(id => old[id]?.length);
  const baseline = previous ?? (hasChoices ? {
    level: character.level, selections: old, cantripsRemaining: 0, preparedRemaining: 0,
  } : null);
  if (!explicit) return { history: baseline };
  const profile = spellcastingProfile(character, spells, traits);
  const gained = baseline ? Math.max(0, character.level - baseline.level) : 0;
  if (baseline && character.level < baseline.level) {
    return { error: 'Pact Magic: poziom jest niższy od zapisanego poziomu wyboru czarów. Przywróć poziom postaci przed zmianą czarów.' };
  }
  const history = { level: character.level, selections: {}, cantripsRemaining: 0, preparedRemaining: 0 };
  for (const id of ['cantrips', 'prepared']) {
    const group = profile.groups.find(group => group.id === id);
    const selected = spells.selections[id] ?? [];
    if (selected.length !== group.limit) return { error: `Pact Magic: ${group.label} — wybierz dokładnie ${group.limit}.` };
    const available = new Set(group.options.map(spell => spell.id));
    // A spell newly granted by a patron leaves the ordinary list without using a replacement.
    const removed = (old[id] ?? []).filter(spell => available.has(spell) && !selected.includes(spell)).length;
    const remaining = baseline ? gained || baseline[`${id}Remaining`] : 0;
    if (removed > remaining) return { error: `Pact Magic: ${group.label} — możesz wymienić ${remaining} czarów przy awansie; bez awansu nie możesz zmieniać zapisanych wyborów.` };
    history[`${id}Remaining`] = remaining - removed;
    history.selections[id] = [...selected];
  }
  return { history };
}
