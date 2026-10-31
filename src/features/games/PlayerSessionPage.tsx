import { useEffect, useState } from 'react';
import { api, type Character, type CharacterSession } from '../../api';
import { GamePage } from '../game/GamePage';
import { LiveBattle, useBattle } from './LiveBattle';

function PlayerCombat({ gameId, sessionId, character, onBack }: { gameId: number; sessionId: number; character: Character; onBack: () => void }) {
  const controller = useBattle(gameId, sessionId);
  const [dismissedSummary, setDismissedSummary] = useState<string | null>(null);
  const battle = controller.response?.battle;
  const summaryKey = battle ? `${battle.startedAt ?? 'legacy'}:${battle.version}` : null;
  if (battle && (battle.active || dismissedSummary !== summaryKey)) {
    const fighter = battle.fighters.find(f => f.characterId === character.id);
    return <><LiveBattle controller={controller} onReturnToExploration={() => setDismissedSummary(summaryKey)} /><details><summary>Karta postaci</summary><GamePage key={`${character.id}-${fighter?.hp}-${fighter?.tempHp}-${fighter?.deathSuccesses}-${fighter?.deathFailures}`} character={character} onBack={onBack} /></details></>;
  }
  return <>{controller.error && <p className="form-error" role="alert">{controller.error}</p>}{battle && !battle.active && <button className="text-button" onClick={() => setDismissedSummary(null)}>Pokaż podsumowanie ostatniej walki</button>}<GamePage character={character} onBack={onBack} /></>;
}

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
      {state.game && <PlayerCombat gameId={state.game.id} sessionId={sessionId} character={character} onBack={onBack} />}
    </> : <><h1>Sesja niedostępna</h1><p role="status">Sesja została zakończona lub postać już w niej nie uczestniczy. Przynależność do gry sprawdzisz na liście postaci.</p><button className="primary-button" onClick={onBack}>Wróć do postaci</button></>}
  </>;
}
