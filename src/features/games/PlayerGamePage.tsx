import { useEffect, useState } from 'react';
import { api, type Character } from '../../api';
import { PlayerSessionPage } from './PlayerSessionPage';

// Resolve the character from the signed-in user's API, never from URL data.
export function PlayerGamePage({ characterId, sessionId, onBack }: { characterId: number; sessionId: number; onBack: () => void }) {
  const [character, setCharacter] = useState<Character | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    setLoading(true); setError(''); setCharacter(null);
    api<{ characters: Character[] }>('/characters').then(data => {
      if (!alive) return;
      const owned = data.characters.find(c => c.id === characterId);
      if (!owned) throw new Error('Ta postać jest niedostępna dla zalogowanego użytkownika.');
      setCharacter(owned);
    }).catch(e => { if (alive) setError(e instanceof Error ? e.message : 'Nie udało się wczytać postaci.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [characterId]);
  useEffect(() => {
    const previous = document.title;
    document.title = character ? `${character.gameName ?? 'Gra'} · ${character.name} — sesja | DnD RnR` : 'Trwająca gra | DnD RnR';
    return () => { document.title = previous; };
  }, [character]);
  if (loading) return <p role="status">Wczytywanie trwającej gry…</p>;
  if (error || !character) return <><p role="alert" className="form-error">{error || 'Nie znaleziono postaci.'}</p><button className="text-button" onClick={onBack}>Wróć do postaci</button></>;
  return <PlayerSessionPage key={`${characterId}-${sessionId}`} character={character} sessionId={sessionId} onBack={onBack} />;
}
