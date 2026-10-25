import { useEffect, useState, type FormEvent } from 'react';
import { api, type User } from '../../api';
import { Card } from '../../components/ui/Card';

export function AdminPage() {
  const [players, setPlayers] = useState<User[]>([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(true);
  async function load() { setPlayers((await api<{ players: User[] }>('/admin/players')).players); }
  useEffect(() => { load().catch(e => setError(e.message)).finally(() => setLoading(false)); }, []);
  async function submit(event: FormEvent<HTMLFormElement>, character: boolean) {
    event.preventDefault(); const form = event.currentTarget; const values = Object.fromEntries(new FormData(form));
    setPending(true); setError(''); setMessage('');
    try {
      await api(character ? '/admin/characters' : '/admin/players', character ? { ...values, userId: Number(values.userId) } : values);
      form.reset();
      setMessage(character ? 'Postać przypisana do gracza.' : 'Konto gracza utworzone. Przekaż mu login i hasło prywatnym kanałem.');
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Błąd połączenia.'); }
    finally { setPending(false); }
  }
  return <><header className="page-heading"><p className="eyebrow">ADMINISTRACJA</p><h1>Gracze i postacie</h1><p>Twórz konta i przypisuj bohaterów do ich właścicieli.</p></header>
    {error && <p role="alert" className="form-error">{error}</p>}{message && <p role="status">{message}</p>}
    <div className="dashboard-grid"><Card title="Nowe konto gracza"><form className="stack-form" onSubmit={e => submit(e, false)}>
      <label>Imię gracza<input name="name" required maxLength={80} autoComplete="off" /></label>
      <label>Login<input name="username" required minLength={3} maxLength={40} pattern="[a-z0-9._\-]{3,40}" autoCapitalize="none" autoComplete="off" /><small>3–40 znaków: małe litery, cyfry, kropka, _ lub -.</small></label>
      <label>Hasło<input name="password" type="password" required minLength={12} maxLength={128} autoComplete="new-password" /><small>Minimum 12 znaków.</small></label>
      <button className="primary-button" disabled={pending}>Utwórz konto</button>
    </form></Card><Card title="Przypisz postać"><form className="stack-form" onSubmit={e => submit(e, true)}>
      <label>Gracz<select name="userId" required defaultValue=""><option value="" disabled>Wybierz gracza</option>{players.map(p => <option key={p.id} value={p.id}>{p.name} ({p.username})</option>)}</select></label>
      <label>Imię postaci<input name="name" required maxLength={80} /></label>
      <label>Klasa<input name="characterClass" required maxLength={80} placeholder="np. Wojownik" /></label>
      <button className="primary-button" disabled={pending || !players.length}>Przypisz postać</button>
    </form></Card></div>
    <section className="player-list"><h2>Konta graczy</h2>{loading ? <p role="status">Wczytywanie…</p> : players.length ? <ul>{players.map(p => <li key={p.id}><strong>{p.name}</strong> <span>@{p.username}</span></li>)}</ul> : <p>Nie utworzono jeszcze kont graczy.</p>}</section>
  </>;
}
