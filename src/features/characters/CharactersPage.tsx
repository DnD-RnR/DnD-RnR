import { CharacterGameInfo } from './CharacterGameInfo';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { useEffect, useState } from 'react';
import { api, type Character } from '../../api';

export function CharactersPage({ onSelect, onCreate }: { onCreate: () => void; onSelect: (character: Character) => void }) {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => { api<{ characters: Character[] }>('/characters').then(data => setCharacters(data.characters)).catch(e => setError(e.message)).finally(() => setLoading(false)); }, []);
  return <><header className="page-heading"><p className="eyebrow">TWOI BOHATEROWIE</p><h1>Moje postacie</h1><p>Twoi towarzysze kolejnych przygód.</p><button className="primary-button" onClick={onCreate}>Utwórz postać</button></header>
    {loading ? <p role="status">Wczytywanie postaci…</p> : error ? <p className="form-error" role="alert">{error}</p> : characters.length ? <div className="dashboard-grid">{characters.map(character => <Card key={character.id} title={character.name} eyebrow={`POZIOM ${character.level}`}><p>{[character.species, character.class, character.subclass].filter(Boolean).join(' · ')}</p><p>Pochodzenie: {character.background || 'Do uzupełnienia'}</p><CharacterGameInfo character={character} /><button className="primary-button" onClick={() => onSelect(character)} aria-label={`Wejdź do gry jako ${character.name}`}>Wejdź do gry →</button></Card>)}</div> : <Card title="Twoje postacie"><EmptyState symbol="♙" title="Twoja historia dopiero się zaczyna" description="Nie masz jeszcze postaci. Wybierz przycisk Utwórz postać, aby stworzyć bohatera." /></Card>}
  </>;
}
