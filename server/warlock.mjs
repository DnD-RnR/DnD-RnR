import { spellcastingProfile } from '../shared/spellcasting.mjs';
import { invocationCount, invocationOptions } from '../shared/warlock-invocations.mjs';

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
