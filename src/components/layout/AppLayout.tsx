import { useState, type ReactNode } from 'react';
import { navigation, type PageId } from '../../app/navigation';
import type { User } from '../../api';

type AppLayoutProps = {
  activePage: PageId;
  onNavigate: (page: PageId) => void;
  children: ReactNode;
  user: User;
  onLogout: () => void;
  logoutPending: boolean;
};

export function AppLayout({ activePage, onNavigate, children, user, onLogout, logoutPending }: AppLayoutProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const navigationPage = activePage === 'create-character' ? 'admin' : activePage;

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">Przejdź do treści</a>
      <header className="mobile-header">
        <span className="brand">◈ DnD <span>RnR</span></span>
        <button className="menu-toggle" aria-expanded={menuOpen} aria-controls="navigation" onClick={() => setMenuOpen(!menuOpen)}>
          {menuOpen ? 'Zamknij menu' : 'Otwórz menu'}
        </button>
      </header>
      <aside className={`sidebar ${menuOpen ? 'is-open' : ''}`}>
        <div className="desktop-brand brand">◈ DnD <span>RnR</span></div>
        <p className="sidebar-label">PRZESTRZEŃ DRUŻYNY</p>
        <nav id="navigation" aria-label="Nawigacja główna">
          {[...navigation, ...(user.role === 'admin' ? [{ id: 'admin' as const, label: 'Administracja', symbol: '⚙' }] : [])].map(({ id, label, symbol }) => (
            <button key={id} className={`nav-item ${navigationPage === id ? 'is-active' : ''}`} aria-current={navigationPage === id ? 'page' : undefined} onClick={() => { onNavigate(id); setMenuOpen(false); }}>
              <span aria-hidden="true">{symbol}</span>{label}
            </button>
          ))}
        </nav>
        <div className="account"><strong>{user.name}</strong><span>{user.role === 'admin' ? 'Administrator' : 'Gracz'}</span><button className="text-button" onClick={onLogout} disabled={logoutPending}>{logoutPending ? 'Wylogowywanie…' : 'Wyloguj się'}</button></div>
      </aside>
      <main id="main" tabIndex={-1}>{children}</main>
    </div>
  );
}
