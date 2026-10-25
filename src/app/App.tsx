import { useEffect, useState } from 'react';
import { api, type User } from '../api';
import { LoginPage } from '../features/auth/LoginPage';
import { AdminPage } from '../features/admin/AdminPage';
import type { PageId } from './navigation';
import { AppLayout } from '../components/layout/AppLayout';
import { CampaignPage } from '../features/campaign/CampaignPage';
import { CharactersPage } from '../features/characters/CharactersPage';
import { SessionsPage } from '../features/sessions/SessionsPage';
import { NotesPage } from '../features/notes/NotesPage';

export function App() {
  const [activePage, setActivePage] = useState<PageId>('characters');
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
      {activePage === 'admin' && user.role === 'admin' && <AdminPage />}
      {activePage === 'campaign' && <CampaignPage onNavigate={setActivePage} />}
      {activePage === 'characters' && <CharactersPage />}
      {activePage === 'sessions' && <SessionsPage />}
      {activePage === 'notes' && <NotesPage />}
    </AppLayout>
  );
}
