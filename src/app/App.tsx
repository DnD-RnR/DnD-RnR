import { GamesPage } from '../features/games/GamesPage';
import { GameSessionPage } from '../features/games/GameSessionPage';
import { PlayerSessionPage } from '../features/games/PlayerSessionPage';
import { useEffect, useState } from 'react';
import { api, type User, type Character } from '../api';
import { GamePage } from '../features/game/GamePage';
import { LoginPage } from '../features/auth/LoginPage';
import { AdminPage } from '../features/admin/AdminPage';
import { CreateCharacterPage } from '../features/characters/CreateCharacterPage';
import type { PageId } from './navigation';
import { AppLayout } from '../components/layout/AppLayout';
import { CharactersPage } from '../features/characters/CharactersPage';

export function App() {
  const [gameWindowId] = useState(() => {
    const value = new URLSearchParams(window.location.search).get('gmGame');
    return value && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
  });
  const [activePage, setActivePage] = useState<PageId>('characters');
  const [selectedCharacter, setSelectedCharacter] = useState<Character | null>(null);
  const [joinedSessionId, setJoinedSessionId] = useState<number | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [logoutPending, setLogoutPending] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    api<{ user: User }>('/me').then(data => { setUser(data.user); if (data.user.role === 'gm') setActivePage('games'); }).catch(() => {}).finally(() => setLoading(false));
    const expire = () => setUser(null);
    window.addEventListener('session-expired', expire);
    return () => window.removeEventListener('session-expired', expire);
  }, []);
  async function logout() {
    setLogoutPending(true); setError('');
    try { await api('/logout', {}); setUser(null); }
    catch { setError('Nie udało się wylogować. Spróbuj ponownie.'); }
    finally { setLogoutPending(false); }
  }
  if (loading) return <div className="loading-screen" role="status">Wczytywanie drużyny…</div>;
  if (!user) return <LoginPage onLogin={nextUser => { setUser(nextUser); setActivePage(nextUser.role === 'admin' ? 'admin' : nextUser.role === 'gm' ? 'games' : 'characters'); setError(''); }} />;

  if (gameWindowId !== null) return <div className="game-window-shell">
    <header className="game-window-toolbar"><a className="text-button" href={window.location.pathname}>← Wróć do gier</a><span>{user.name} · {user.role === 'gm' ? 'GM' : user.role === 'admin' ? 'Administrator' : 'Gracz'}</span><button className="text-button" onClick={logout} disabled={logoutPending}>Wyloguj się</button></header>
    <main id="main" tabIndex={-1}>
      {error && <p role="alert" className="form-error">{error}</p>}
      {user.role === 'gm' ? <GameSessionPage key={`${user.id}-${gameWindowId}`} gameId={gameWindowId} /> : <p role="alert" className="form-error">Widok gry jest dostępny tylko dla prowadzącego ją GM.</p>}
    </main>
  </div>;

  return (
    <AppLayout key={user.id} user={user} activePage={activePage} onNavigate={setActivePage} onLogout={logout} logoutPending={logoutPending}>
      {error && <p role="alert" className="form-error">{error}</p>}
      {activePage === 'admin' && user.role === 'admin' && <AdminPage onCreateCharacter={() => setActivePage('create-character')} />}
      {activePage === 'create-character' && <CreateCharacterPage key={user.id} user={user} onBack={() => setActivePage(user.role === 'admin' ? 'admin' : 'characters')} />}
      {activePage === 'games' && <GamesPage key={user.id} user={user} />}
      {activePage === 'characters' && <CharactersPage onCreate={() => setActivePage('create-character')} onSelect={character => { setJoinedSessionId(null); setSelectedCharacter(character); setActivePage('game'); }} onEnter={(character, sessionId) => { setJoinedSessionId(sessionId); setSelectedCharacter(character); setActivePage('game'); }} />}
      {activePage === 'game' && selectedCharacter && (joinedSessionId !== null ? <PlayerSessionPage key={`${user.id}-${selectedCharacter.id}-${joinedSessionId}`} character={selectedCharacter} sessionId={joinedSessionId} onBack={() => setActivePage('characters')} /> : <GamePage key={`${user.id}-${selectedCharacter.id}`} character={selectedCharacter} onBack={() => setActivePage('characters')} />)}
    </AppLayout>
  );
}
