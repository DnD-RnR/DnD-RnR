import definitions from '../shared/statistics.json' with { type: 'json' };
import { emptySpellSelection, spellcastingProfile, validateSpellSelection } from '../shared/spellcasting.mjs';
import { characterTraits, emptyTraitSelection, validateTraitSelection } from '../shared/character-traits.mjs';
import { armorClassFromEquipment, armorSpeedPenalty, armorTrainingEffects, hasArmorTraining, hasStealthDisadvantage, speedFromEquipment } from './armor-class.mjs';
import { weaponMasteryChoicesValid } from '../shared/weapon-mastery.mjs';
import { fightingStyleChoicesValid } from '../shared/fighting-style.mjs';

export function emptyStatistics() {
  return {
    traits: emptyTraitSelection(),
    spells: emptySpellSelection(),
    values: Object.fromEntries([...definitions.abilities, ...definitions.numbers].map(field => [field.id, null])),
    savingThrows: [],
    skills: Object.fromEntries(definitions.skills.map(skill => [skill.id, 0])),
    spellAbility: '',
    notes: Object.fromEntries(definitions.notes.map(field => [field.id, ''])),
    choices: { weaponMastery: [], fightingStyle: '' },
  };
}
function validStatistics(stats) {
  if (!stats || typeof stats !== 'object' || !stats.values || !stats.skills || !stats.notes || !Array.isArray(stats.savingThrows)) return false;
  const abilities = definitions.abilities.map(ability => ability.id);
  if (stats.spellAbility !== '' && !abilities.includes(stats.spellAbility)) return false;
  if (stats.savingThrows.some(id => !abilities.includes(id)) || new Set(stats.savingThrows).size !== stats.savingThrows.length) return false;
  for (const field of [...definitions.abilities.map(ability => ({ ...ability, min: 1, max: 30 })), ...definitions.numbers]) {
    const value = stats.values[field.id];
    if (value !== null && (!Number.isInteger(value) || value < field.min || value > field.max)) return false;
  }
  if (definitions.skills.some(skill => ![0, 1, 2].includes(stats.skills[skill.id]))) return false;
  if (definitions.notes.some(field => typeof stats.notes[field.id] !== 'string' || stats.notes[field.id].length > 1500)) return false;
  return true;
}
export function handleStatistics(db, user, path, method, body, send) {
  const match = path.match(/^\/api\/characters\/([1-9]\d*)\/(statistics|choices)$/);
  if (!match) return false;
  const characterId = Number(match[1]);
  const character = Number.isSafeInteger(characterId) && db.prepare('SELECT id, class, level, subclass, species, background FROM characters WHERE id = ? AND user_id = ?').get(characterId, user.id);
  if (!character) {
    send(404, { error: 'Nie znaleziono postaci.' }); return true;
  }
  if (match[2] === 'choices') {
    if (method === 'GET') {
      const stored = db.prepare('SELECT data FROM character_statistics WHERE character_id = ?').get(characterId);
      const choices = stored ? JSON.parse(stored.data).choices ?? {} : {};
      send(200, { choices: { weaponMastery: choices.weaponMastery ?? [], fightingStyle: choices.fightingStyle ?? '' } });
    } else if (method === 'POST') {
      if (!body || !weaponMasteryChoicesValid(character, body.weaponMastery) || !fightingStyleChoicesValid(character, body.fightingStyle ?? '')) {
        send(400, { error: 'Wybierz poprawne, niepowtarzające się bronie do Weapon Mastery.' }); return true;
      }
      const stored = db.prepare('SELECT data FROM character_statistics WHERE character_id = ?').get(characterId);
      const stats = stored ? JSON.parse(stored.data) : emptyStatistics();
      stats.choices = { weaponMastery: body.weaponMastery, fightingStyle: body.fightingStyle ?? '' };
      db.prepare('INSERT INTO character_statistics (character_id, data) VALUES (?, ?) ON CONFLICT(character_id) DO UPDATE SET data = excluded.data').run(characterId, JSON.stringify(stats));
      send(200, { choices: stats.choices });
    } else send(405, { error: 'Niedozwolona metoda.' });
  } else if (method === 'GET') {
    const stored = db.prepare('SELECT data FROM character_statistics WHERE character_id = ?').get(characterId);
    const statistics = stored ? JSON.parse(stored.data) : emptyStatistics();
    statistics.spells ??= emptySpellSelection();
    statistics.traits ??= emptyTraitSelection();
    statistics.choices ??= { weaponMastery: [], fightingStyle: '' };
    statistics.choices.fightingStyle ??= '';
    statistics.spellAbility = spellcastingProfile(character, statistics.spells).ability || statistics.spellAbility;
    const equipment = db.prepare(`SELECT i.equipped, a.category AS armorCategory, a.armor_class AS armorClass, a.strength,
      a.stealth_disadvantage AS stealthDisadvantage
      FROM character_items i JOIN armor_catalog a ON a.id = i.armor_id WHERE i.character_id = ?`).all(characterId);
    const trainingEffects = armorTrainingEffects(characterTraits(character, statistics), equipment);
    statistics.values.ac = armorClassFromEquipment(statistics, equipment.map(item => ({ ...item, trained: hasArmorTraining(characterTraits(character, statistics), item.armorCategory) })));
    statistics.values.speed = speedFromEquipment(statistics, equipment, statistics.values.speed);
    if (hasStealthDisadvantage(equipment)) statistics.stealthDisadvantage = true;
    Object.entries(trainingEffects).forEach(([key, value]) => { if (value) statistics[key] = true; });
    send(200, { statistics });
  } else if (method === 'POST') {
    if (!validStatistics(body)) { send(400, { error: 'Sprawdź statystyki: cechy 1–30, zakresy liczb i długość notatek (do 1500 znaków).' }); return true; }
    const stored = db.prepare('SELECT data FROM character_statistics WHERE character_id = ?').get(characterId);
    const combats = db.prepare(`SELECT b.data FROM session_battles b JOIN game_sessions s ON s.id = b.session_id
      JOIN game_members m ON m.game_id = s.game_id WHERE m.character_id = ? AND s.ended_at IS NULL`).all(characterId);
    const fighting = combats.some(row => { const battle = JSON.parse(row.data); return battle.active && battle.fighters.some(f => f.characterId === characterId); });
    if (fighting && stored) {
      const current = JSON.parse(stored.data).values;
      if (['hp', 'tempHp', 'deathSuccesses', 'deathFailures'].some(key => body.values[key] !== current[key])) {
        send(409, { error: 'PW i rzuty przeciw śmierci zmieniły się w trwającej walce. Odśwież kartę; te wartości zmieniaj na ekranie walki.' }); return true;
      }
    }
    const spells = Object.hasOwn(body, 'spells') ? body.spells : (stored ? JSON.parse(stored.data).spells : null) ?? emptySpellSelection();
    const spellError = validateSpellSelection(character, spells);
    if (spellError) { send(400, { error: spellError }); return true; }
    const submittedTraits = Object.hasOwn(body, 'traits') ? body.traits : (stored ? JSON.parse(stored.data).traits : null) ?? emptyTraitSelection();
    const submittedTraitEntries = submittedTraits && typeof submittedTraits === 'object' && !Array.isArray(submittedTraits) ? Object.entries(submittedTraits) : [];
    const supportedTraitGroups = new Set(characterTraits(character, { ...body, spells, traits: submittedTraits }).groups.map(group => group.id));
    if (submittedTraitEntries.some(([id]) => !supportedTraitGroups.has(id))) { send(400, { error: 'Wybór biegłości nie pasuje do obecnej klasy, gatunku lub pochodzenia.' }); return true; }
    const traits = Object.fromEntries(submittedTraitEntries.filter(([id]) => supportedTraitGroups.has(id)));
    const traitError = validateTraitSelection(character, { ...body, spells, traits, requireCompleteTraits: true });
    if (traitError) { send(400, { error: traitError }); return true; }
    const choices = Object.hasOwn(body, 'choices') ? body.choices : (stored ? JSON.parse(stored.data).choices : null) ?? { weaponMastery: [], fightingStyle: '' };
    if (!choices || !weaponMasteryChoicesValid(character, choices.weaponMastery ?? []) || !fightingStyleChoicesValid(character, choices.fightingStyle ?? '')) { send(400, { error: 'Wybierz poprawne wybory Weapon Mastery i Fighting Style.' }); return true; }
    // Store only supported fields, never arbitrary properties from the request.
    const stats = emptyStatistics();
    for (const key of Object.keys(stats.values)) stats.values[key] = body.values[key];
    for (const key of Object.keys(stats.skills)) stats.skills[key] = body.skills[key];
    for (const key of Object.keys(stats.notes)) stats.notes[key] = body.notes[key];
    stats.savingThrows = body.savingThrows;
    stats.spells = spells;
    stats.traits = traits;
    stats.choices = { weaponMastery: choices.weaponMastery, fightingStyle: choices.fightingStyle ?? '' };
    stats.spellAbility = spellcastingProfile(character, spells).ability || body.spellAbility;
    const equipment = db.prepare(`SELECT i.equipped, a.category AS armorCategory, a.strength
      FROM character_items i JOIN armor_catalog a ON a.id = i.armor_id WHERE i.character_id = ?`).all(characterId);
    if (stats.values.speed !== null) stats.values.speed += armorSpeedPenalty(stats, equipment);
    db.prepare('INSERT INTO character_statistics (character_id, data) VALUES (?, ?) ON CONFLICT(character_id) DO UPDATE SET data = excluded.data').run(characterId, JSON.stringify(stats));
    const outputEquipment = db.prepare(`SELECT i.equipped, a.category AS armorCategory, a.armor_class AS armorClass, a.strength,
      a.stealth_disadvantage AS stealthDisadvantage
      FROM character_items i JOIN armor_catalog a ON a.id = i.armor_id WHERE i.character_id = ?`).all(characterId);
    const outputTraits = characterTraits(character, stats);
    const outputEffects = armorTrainingEffects(outputTraits, outputEquipment);
    stats.values.ac = armorClassFromEquipment(stats, outputEquipment.map(item => ({ ...item, trained: hasArmorTraining(outputTraits, item.armorCategory) })));
    stats.values.speed = speedFromEquipment(stats, outputEquipment, stats.values.speed);
    if (hasStealthDisadvantage(outputEquipment)) stats.stealthDisadvantage = true;
    Object.entries(outputEffects).forEach(([key, value]) => { if (value) stats[key] = true; });
    send(200, { statistics: stats });
  } else send(405, { error: 'Niedozwolona metoda.' });
  return true;
}
