import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { useEffect, useState } from 'react';
import { api, type Character } from '../../api';

export function CharactersPage() {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => { api<{ characters: Character[] }>('/characters').then(data => setCharacters(data.characters)).catch(e => setError(e.message)).finally(() => setLoading(false)); }, []);
  return <><header className="page-heading"><p className="eyebrow">TWOI BOHATEROWIE</p><h1>Moje postacie</h1><p>Twoi towarzysze kolejnych przygód.</p></header>
    {loading ? <p role="status">Wczytywanie postaci…</p> : error ? <p className="form-error" role="alert">{error}</p> : characters.length ? <div className="dashboard-grid">{characters.map(character => <Card key={character.id} title={character.name} eyebrow={`POZIOM ${character.level}`}><p>{character.class}</p></Card>)}</div> : <Card title="Twoje postacie"><EmptyState symbol="♙" title="Twoja historia dopiero się zaczyna" description="Administrator nie przypisał Ci jeszcze postaci. Skontaktuj się z nim przed kolejną sesją." /></Card>}
  </>;
}
