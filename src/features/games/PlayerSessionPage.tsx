import { useEffect, useState } from 'react';
import { api, type Character, type CharacterSession } from '../../api';
import { GamePage } from '../game/GamePage';

export function PlayerSessionPage({ character, sessionId, onBack }: { character: Character; sessionId: number; onBack: () => void }) {
  const [state, setState] = useState<CharacterSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const data = await api<CharacterSession>(`/characters/${character.id}/session`);
        if (alive) { setState(data); setError(''); }
      } catch (e) { if (alive) setError(e instanceof Error ? e.message : 'Błąd połączenia.'); }
      finally { if (alive) setLoading(false); }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    const focus = () => void refresh();
    window.addEventListener('focus', focus);
    return () => { alive = false; window.clearInterval(timer); window.removeEventListener('focus', focus); };
  }, [character.id, sessionId]);
  async function leave() {
    setPending(true); setError('');
    try { await api(`/characters/${character.id}/session/leave`, { sessionId }); onBack(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Błąd połączenia.'); }
    finally { setPending(false); }
  }
  const active = state?.activeSession?.id === sessionId && state.activeSession.participating;
  return <>
    {error && <p role="alert" className="form-error">{error}</p>}
    {loading ? <p role="status">Łączenie z sesją…</p> : active ? <>
      <section className="welcome-banner"><div><p className="eyebrow">TRWAJĄCA SESJA</p><h2>{state.game?.name}</h2><p>Uczestniczysz jako {character.name}.</p><button className="text-button" disabled={pending} onClick={() => void leave()}>Opuść sesję</button></div></section>
      <GamePage character={character} onBack={onBack} />
    </> : <><h1>Sesja niedostępna</h1><p role="status">Sesja została zakończona lub postać już w niej nie uczestniczy. Przynależność do gry sprawdzisz na liście postaci.</p><button className="primary-button" onClick={onBack}>Wróć do postaci</button></>}
  </>;
}
