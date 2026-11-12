import { CharacterGameInfo } from './CharacterGameInfo';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { useEffect, useState } from 'react';
import { api, type Character } from '../../api';

export function CharactersPage({ onSelect, onCreate, onEnter }: { onCreate: () => void; onSelect: (character: Character) => void; onEnter: (character: Character, sessionId: number) => void }) {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState<number | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const load = () => api<{ characters: Character[] }>('/characters').then(data => setCharacters(data.characters));
    const refresh = () => { void load().catch(e => setError(e.message)); };
    load().catch(e => setError(e.message)).finally(() => setLoading(false));
    const timer = window.setInterval(refresh, 5000);
    window.addEventListener('focus', refresh);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, []);
  async function join(character: Character) {
    if (joining !== null || !character.activeSessionId) return;
    setJoining(character.id); setError('');
    try {
      const data = await api<{ sessionId: number }>(`/characters/${character.id}/session/join`, { sessionId: character.activeSessionId });
      onEnter(character, data.sessionId);
    } catch (e) { setError(e instanceof Error ? e.message : 'B\u0142\u0105d po\u0142\u0105czenia.'); }
    finally { setJoining(null); }
  }
  return <><header className="page-heading"><p className="eyebrow">TWOI BOHATEROWIE</p><h1>Moje postacie</h1><p>Twoi towarzysze kolejnych przygód.</p><button className="primary-button" onClick={onCreate}>Utwórz postać</button></header>
    {error && <p className="form-error" role="alert">{error}</p>}
    {characters.filter(c => c.pendingAdvancement).map(c => <p key={c.id} role="status" className="inventory-message">{c.name}: możesz awansować na poziom {c.level + 1}! <button className="text-button" onClick={() => onSelect(c)}>Rozwiń postać w zakładce Rozwój</button></p>)}
    {loading ? <p role="status">Wczytywanie postaci…</p> : characters.length ? <div className="dashboard-grid">{characters.map(character => <Card key={character.id} title={character.name} eyebrow={`POZIOM ${character.level}`}><p>{[character.species, character.class, character.subclass].filter(Boolean).join(' · ')}</p><p>Pochodzenie: {character.background || 'Do uzupełnienia'}</p><CharacterGameInfo character={character} /><p>{character.activeSessionId ? character.participating ? 'Uczestniczysz w bie\u017c\u0105cej sesji.' : 'Sesja trwa \u2014 mo\u017cesz do\u0142\u0105czy\u0107.' : character.gameName ? 'GM nie rozpocz\u0105\u0142 jeszcze sesji.' : 'Najpierw do\u0142\u0105cz do gry przez zaproszenie.'}</p><div className="admin-actions"><button className="primary-button" disabled={joining !== null || !character.activeSessionId} onClick={() => void join(character)}>{joining === character.id ? 'Do\u0142\u0105czanie\u2026' : character.participating ? 'Wr\u00f3\u0107 do sesji' : 'Wejd\u017a do gry'}</button><button className="text-button" onClick={() => onSelect(character)}>{'Podgl\u0105d'}</button></div></Card>)}</div> : <Card title="Twoje postacie"><EmptyState symbol="♙" title="Twoja historia dopiero się zaczyna" description="Nie masz jeszcze postaci. Wybierz przycisk Utwórz postać, aby stworzyć bohatera." /></Card>}
  </>;
}
