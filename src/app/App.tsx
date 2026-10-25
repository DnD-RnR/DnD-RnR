import { useEffect, useState } from 'react';
import { api, type User, type Character } from '../api';
import { GamePage } from '../features/game/GamePage';
import { LoginPage } from '../features/auth/LoginPage';
import { AdminPage } from '../features/admin/AdminPage';
import { CreateCharacterPage } from '../features/admin/CreateCharacterPage';
import type { PageId } from './navigation';
import { AppLayout } from '../components/layout/AppLayout';
import { CharactersPage } from '../features/characters/CharactersPage';

export function App() {
  const [activePage, setActivePage] = useState<PageId>('characters');
  const [selectedCharacter, setSelectedCharacter] = useState<Character | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [logoutPending, setLogoutPending] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    api<{ user: User }>('/me').then(data => setUser(data.user)).catch(() => {}).finally(() => setLoading(false));
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
  if (!user) return <LoginPage onLogin={nextUser => { setUser(nextUser); setActivePage(nextUser.role === 'admin' ? 'admin' : 'characters'); setError(''); }} />;

  return (
    <AppLayout key={user.id} user={user} activePage={activePage} onNavigate={setActivePage} onLogout={logout} logoutPending={logoutPending}>
      {error && <p role="alert" className="form-error">{error}</p>}
      {activePage === 'admin' && user.role === 'admin' && <AdminPage onCreateCharacter={() => setActivePage('create-character')} />}
      {activePage === 'create-character' && user.role === 'admin' && <CreateCharacterPage onBack={() => setActivePage('admin')} />}
      {activePage === 'characters' && <CharactersPage onSelect={character => { setSelectedCharacter(character); setActivePage('game'); }} />}
      {activePage === 'game' && selectedCharacter && <GamePage key={`${user.id}-${selectedCharacter.id}`} character={selectedCharacter} onBack={() => setActivePage('characters')} />}
    </AppLayout>
  );
}
