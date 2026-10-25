import { useState } from 'react';
import type { Character, User } from '../../api';
import options from '../../../shared/character-options.json';

type Props = { players: User[]; character?: Character & { userId: number }; owner?: User; firstLevelOnly?: boolean };
export function CharacterFields({ players, character, owner, firstLevelOnly = false }: Props) {
  const [characterClass, setClass] = useState(character?.class ?? '');
  const [level, setLevel] = useState(character?.level ?? 1);
  const [subclass, setSubclass] = useState(character?.subclass ?? '');
  const selectedClass = options.classes.find(entry => entry.name === characterClass);
  return <>
    <p>D&D 2024 · Player’s Handbook. Wybierz podstawy postaci. Wartości z karty uzupełnisz później w zakładce Statystyki.</p>
    {owner ? <><input type="hidden" name="userId" value={owner.id} /><p>Właściciel: {owner.name}</p></> : <label>Właściciel<select name="userId" required defaultValue={character?.userId ?? ''}><option value="" disabled>Wybierz konto</option>{players.map(p => <option key={p.id} value={p.id}>{p.name} ({p.username})</option>)}</select></label>}
    <label>Imię postaci<input name="name" required maxLength={80} defaultValue={character?.name} /></label>
    <label>Gatunek (rasa)<select name="species" required defaultValue={character?.species ?? ''}><option value="" disabled>Wybierz gatunek</option>{options.species.map(value => <option key={value}>{value}</option>)}</select></label>
    <label>Pochodzenie<select name="background" required defaultValue={character?.background ?? ''}><option value="" disabled>Wybierz pochodzenie</option>{options.backgrounds.map(value => <option key={value}>{value}</option>)}</select></label>
    <label>Klasa<select name="characterClass" required value={characterClass} onChange={e => { setClass(e.target.value); setSubclass(''); }}><option value="" disabled>Wybierz klasę</option>{characterClass && !selectedClass && <option value={characterClass} disabled>{characterClass} — wybierz klasę D&D 2024</option>}{options.classes.map(entry => <option key={entry.name}>{entry.name}</option>)}</select></label>
    <label>Poziom<input name="level" type="number" required min={1} max={firstLevelOnly ? 1 : 20} readOnly={firstLevelOnly} value={firstLevelOnly ? 1 : Number.isNaN(level) ? '' : level} onChange={e => { const next = e.target.valueAsNumber; setLevel(next); if (next < 3) setSubclass(''); }} />{firstLevelOnly && <small>Nowa postać gracza zaczyna na poziomie 1.</small>}</label>
    {level >= 3 ? <label>Specjalizacja (podklasa)<select name="subclass" required value={subclass} onChange={e => setSubclass(e.target.value)}><option value="" disabled>Wybierz podklasę</option>{selectedClass?.subclasses.map(value => <option key={value}>{value}</option>)}</select></label> : <><input type="hidden" name="subclass" value="" /><p>Specjalizację (podklasę) wybierzesz od 3. poziomu.</p></>}
    <small>Nazwy angielskie ułatwiają odnalezienie opcji w <a href={options.source} target="_blank" rel="noreferrer">zasadach D&D 2024</a>.</small>
  </>;
}
