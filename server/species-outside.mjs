import { randomUUID } from 'node:crypto';
import { handleSpecies } from './species.mjs';
import { resourceState, saveResources, publicCaster } from './spell-resources.mjs';
import { characterTraits } from '../shared/character-traits.mjs';
import { isIncapacitated } from '../shared/conditions.mjs';

export function speciesOutside(db, id, body) {
  const c = publicCaster(db, id), state = resourceState(db, id);
  if (body.version !== state.version) throw new Error('Zasoby zmieniły się. Odśwież kartę.');
  if (db.prepare('SELECT data FROM session_battles').all().some(row => { const b = JSON.parse(row.data); return b.active && b.fighters.some(f => f.characterId === id); })) throw new Error('W trakcie walki użyj jej kontrolek gatunku.');
  const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(id);
  const stats = JSON.parse(db.prepare('SELECT data FROM character_statistics WHERE character_id = ?').get(id)?.data ?? '{}');
  const subject = { hp: stats.values?.hp, manualConditions: state.manualConditions, conditionSources: state.conditionSources, timedEffects: state.activeEffects };
  if (!(subject.hp > 0) || isIncapacitated(subject)) throw new Error('Postać nie może teraz używać zdolności.');
  if (body.ability === 'gnome-device' || body.ability === 'gnome-dismantle') {
    if (character.species !== 'Gnom (Gnome)' || stats.traits?.gnomeLineage?.[0] !== 'rock' || !body.confirmed) throw new Error('Urządzenie wymaga skalnego Gnoma i potwierdzenia czasu / dotyku z MG.');
    const devices = (state.gnomeDevices ?? []).filter(d => d.expiresAt > Date.now());
    if (body.ability === 'gnome-dismantle') {
      if (!devices.some(d => d.id === body.deviceId)) throw new Error('Wybierz istniejące urządzenie.');
      state.gnomeDevices = devices.filter(d => d.id !== body.deviceId);
    } else {
      if (c.blocked) throw new Error('Brak szkolenia w założonym pancerzu uniemożliwia rzucanie Prestidigitation.');
      if (devices.length >= 3 || !['sensory', 'light', 'ignite', 'extinguish', 'clean', 'soil', 'chill', 'warm', 'flavor', 'mark', 'trinket'].includes(body.deviceEffect)) throw new Error('Wybierz pojedynczy efekt Prestidigitation; limit to 3 urządzenia.');
      if (typeof body.description !== 'string' || !body.description.trim() || body.description.length > 300) throw new Error('Opisz ustalone działanie urządzenia.');
      state.gnomeDevices = [...devices, { id: randomUUID(), effect: body.deviceEffect, description: body.description.trim(), ac: 5, hp: 1, size: 'Tiny', expiresAt: Date.now() + 8 * 3600000 }];
    }
    saveResources(db, id, state); return;
  }
  if (!['species-adrenaline', 'species-stonecunning', 'species-healing-hands', 'species-revelation', 'species-large', 'species-flight', 'species-end', 'species-inspiration'].includes(body.ability)) throw new Error('Ta zdolność jest dostępna w panelu walki.');
  if (body.ability === 'species-revelation' && body.form === 'shroud') throw new Error('Necrotic Shroud wymaga celów i rzutów obronnych — użyj panelu walki.');
  const traits = characterTraits(character, stats);
  const f = { ...subject, id: `character:${id}`, characterId: id, species: character.species, level: character.level, hp: stats.values.hp, maxHp: c.effectiveStats.maxHp, tempHp: stats.values.tempHp ?? 0, deathFailures: stats.values.deathFailures ?? 0, deathSuccesses: stats.values.deathSuccesses ?? 0, action: '', bonus: '', reaction: '', speed: c.effectiveStats.speed ?? traits.baseSpeed, speciesEffects: c.species.effects, speciesCha: stats.values.cha == null ? null : Math.floor((stats.values.cha - 10) / 2) };
  if (body.ability === 'species-healing-hands' && f.maxHp == null) throw new Error('Uzupełnij maksymalne PW.');
  handleSpecies({ db, b: { sessionId: null, round: 0, turn: 0, fighters: [f], pending: null }, body: { ...body, kind: body.ability, actorId: f.id, targetId: f.id }, gm: false, canControl: () => true, activeMember: () => true, damage: () => { throw new Error('Obrażenia wymagają panelu walki.'); }, log: () => {}, persistVitals: (_, target) => {
    stats.values.hp = target.hp; stats.values.tempHp = target.tempHp; stats.values.deathFailures = target.deathFailures; stats.values.deathSuccesses = target.deathSuccesses;
    db.prepare('UPDATE character_statistics SET data = ? WHERE character_id = ?').run(JSON.stringify(stats), id);
  } });
}
