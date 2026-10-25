import { useState } from 'react';
import type { Character, User } from '../../api';
import options from '../../../shared/character-options.json';

type Props = { players: User[]; character?: Character & { userId: number } };
export function CharacterFields({ players, character }: Props) {
  const [characterClass, setClass] = useState(character?.class ?? '');
  const [level, setLevel] = useState(character?.level ?? 1);
  const [subclass, setSubclass] = useState(character?.subclass ?? '');
  const selectedClass = options.classes.find(entry => entry.name === characterClass);
  return <>
    <p>D&D 2024 · Player’s Handbook. Wybierz podstawy postaci; statystyki i wyposażenie dodamy w kolejnych krokach.</p>
    <label>Gracz<select name="userId" required defaultValue={character?.userId ?? ''}><option value="" disabled>Wybierz gracza</option>{players.map(p => <option key={p.id} value={p.id}>{p.name} ({p.username})</option>)}</select></label>
    <label>Imię postaci<input name="name" required maxLength={80} defaultValue={character?.name} /></label>
    <label>Gatunek (rasa)<select name="species" required defaultValue={character?.species ?? ''}><option value="" disabled>Wybierz gatunek</option>{options.species.map(value => <option key={value}>{value}</option>)}</select></label>
    <label>Pochodzenie<select name="background" required defaultValue={character?.background ?? ''}><option value="" disabled>Wybierz pochodzenie</option>{options.backgrounds.map(value => <option key={value}>{value}</option>)}</select></label>
    <label>Klasa<select name="characterClass" required value={characterClass} onChange={e => { setClass(e.target.value); setSubclass(''); }}><option value="" disabled>Wybierz klasę</option>{characterClass && !selectedClass && <option value={characterClass} disabled>{characterClass} — wybierz klasę D&D 2024</option>}{options.classes.map(entry => <option key={entry.name}>{entry.name}</option>)}</select></label>
    <label>Poziom<input name="level" type="number" required min={1} max={20} value={Number.isNaN(level) ? '' : level} onChange={e => { const next = e.target.valueAsNumber; setLevel(next); if (next < 3) setSubclass(''); }} /></label>
    {level >= 3 ? <label>Specjalizacja (podklasa)<select name="subclass" required value={subclass} onChange={e => setSubclass(e.target.value)}><option value="" disabled>Wybierz podklasę</option>{selectedClass?.subclasses.map(value => <option key={value}>{value}</option>)}</select></label> : <><input type="hidden" name="subclass" value="" /><p>Specjalizację (podklasę) wybierzesz od 3. poziomu.</p></>}
    <small>Nazwy angielskie ułatwiają odnalezienie opcji w <a href={options.source} target="_blank" rel="noreferrer">zasadach D&D 2024</a>.</small>
  </>;
}
