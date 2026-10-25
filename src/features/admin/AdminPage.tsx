import { ItemCatalog } from './ItemCatalog';
import { CharacterFields } from '../characters/CharacterFields';
import { useEffect, useState, type FormEvent } from 'react';
import { api, type User, type Character } from '../../api';
import { Card } from '../../components/ui/Card';

type AdminCharacter = Character & { userId: number };
export function AdminPage({ onCreateCharacter }: { onCreateCharacter: () => void }) {
  const [players, setPlayers] = useState<User[]>([]);
  const [characters, setCharacters] = useState<AdminCharacter[]>([]);
  const [editing, setEditing] = useState<{ kind: 'players' | 'characters'; id: number } | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(true);
  async function load() {
    const [p, c, g] = await Promise.all([api<{ players: User[] }>('/admin/players'), api<{ characters: AdminCharacter[] }>('/admin/characters'), api<{ players: User[] }>('/admin/gms')]);
    setPlayers([...p.players, ...g.players]); setCharacters(c.characters);
  }
  useEffect(() => { load().catch(e => setError(e.message)).finally(() => setLoading(false)); }, []);
  async function submit(event: FormEvent<HTMLFormElement>, kind: 'players' | 'characters', id?: number) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    setPending(true); setError(''); setMessage('');
    try {
      await api(`/admin/${kind}${id ? `/${id}/update` : ''}`, kind === 'characters' ? { ...values, userId: Number(values.userId), level: Number(values.level) } : values);
      if (id) setEditing(null); else form.reset();
      setMessage(id ? 'Zmiany zapisane.' : kind === 'characters' ? 'Postać przypisana do gracza.' : 'Konto utworzone. Przekaż dane logowania prywatnym kanałem.');
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Błąd połączenia.'); }
    finally { setPending(false); }
  }
  async function remove(kind: 'players' | 'characters', id: number, name: string) {
    if (!window.confirm(kind === 'players' ? `Usunąć konto „${name}” razem ze wszystkimi jego postaciami? Tej operacji nie można cofnąć.` : `Usunąć postać „${name}”? Tej operacji nie można cofnąć.`)) return;
    setPending(true); setError(''); setMessage('');
    try {
      await api(`/admin/${kind}/${id}/delete`, {});
      setEditing(null); setMessage(kind === 'players' ? 'Konto i jego postacie usunięte.' : 'Postać usunięta.');
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Błąd połączenia.'); }
    finally { setPending(false); }
  }
  function playerFields(player?: User) {
    return <>
      {!player && <label>Typ konta<select name="role"><option value="player">Gracz</option><option value="gm">GM — Gamemaster</option></select></label>}
      <label>Imię gracza<input name="name" required maxLength={80} defaultValue={player?.name} autoComplete="off" /></label>
      <label>Login<input name="username" required minLength={3} maxLength={40} pattern="[a-z0-9._\-]{3,40}" defaultValue={player?.username} autoCapitalize="none" autoComplete="off" /><small>3–40 znaków: małe litery, cyfry, kropka, _ lub -.</small></label>
      <label>{player ? 'Nowe hasło (opcjonalnie)' : 'Hasło'}<input name="password" type="password" required={!player} minLength={6} maxLength={128} autoComplete="new-password" /><small>{player ? 'Minimum 6 znaków. Puste pole zachowuje obecne hasło. Zmiana hasła wyloguje gracza.' : 'Minimum 6 znaków.'}</small></label>
    </>;
  }
  const actions = <div className="admin-actions"><button className="primary-button" disabled={pending}>Zapisz zmiany</button><button type="button" className="text-button" disabled={pending} onClick={() => setEditing(null)}>Anuluj</button></div>;
  return <><header className="page-heading"><p className="eyebrow">ADMINISTRACJA</p><h1>Gracze i postacie</h1><p>Twórz, edytuj i usuwaj konta graczy oraz ich postacie.</p></header>
    {error && <p role="alert" className="form-error">{error}</p>}{message && <p role="status">{message}</p>}
    <div className="dashboard-grid"><Card title="Nowe konto gracza lub GM"><form className="stack-form" onSubmit={e => submit(e, 'players')}><fieldset disabled={pending || loading}>{playerFields()}<button className="primary-button">Utwórz konto</button></fieldset></form></Card>
      <Card title="Nowa postać"><p>Stwórz bohatera D&D 2024 i przypisz go do gracza. Gatunek, pochodzenie, klasę i specjalizację wybierzesz w osobnym formularzu.</p>{!loading && !players.length && <p>Najpierw utwórz konto gracza.</p>}<button className="primary-button" disabled={pending || loading || !players.length} onClick={onCreateCharacter}>Utwórz postać</button></Card></div>
    <section className="player-list"><h2>Konta graczy i GM</h2>{loading ? <p role="status">Wczytywanie…</p> : players.length ? <ul>{players.map(p => <li key={p.id}>
      <div className="admin-row"><div><strong>{p.name}</strong> <span>{p.role === 'gm' ? 'GM' : 'Gracz'}</span> <span>@{p.username}</span></div><div className="admin-actions"><button className="text-button" disabled={pending} onClick={() => setEditing({ kind: 'players', id: p.id })} aria-label={`Edytuj konto ${p.username}`}>Edytuj</button><button className="text-button danger-button" disabled={pending} onClick={() => remove('players', p.id, p.name)} aria-label={`Usuń konto ${p.username}`}>Usuń</button></div></div>
      {editing?.kind === 'players' && editing.id === p.id && <form className="stack-form" onSubmit={e => submit(e, 'players', p.id)}><fieldset disabled={pending}>{playerFields(p)}{actions}</fieldset></form>}
    </li>)}</ul> : <p>Nie utworzono jeszcze kont graczy.</p>}</section>
    <section className="player-list"><h2>Postacie</h2>{loading ? <p role="status">Wczytywanie…</p> : characters.length ? <ul>{characters.map(c => <li key={c.id}>
      <div className="admin-row"><div><strong>{c.name}</strong><p>{c.class} · Poziom {c.level} · Gracz: {players.find(p => p.id === c.userId)?.name}</p></div><div className="admin-actions"><button className="text-button" disabled={pending} onClick={() => setEditing({ kind: 'characters', id: c.id })} aria-label={`Edytuj postać ${c.name}`}>Edytuj</button><button className="text-button danger-button" disabled={pending} onClick={() => remove('characters', c.id, c.name)} aria-label={`Usuń postać ${c.name}`}>Usuń</button></div></div>
      {editing?.kind === 'characters' && editing.id === c.id && <form className="stack-form" onSubmit={e => submit(e, 'characters', c.id)}><fieldset disabled={pending}><CharacterFields key={c.id} players={players} character={c} />{actions}</fieldset></form>}
    </li>)}</ul> : <p>Nie utworzono jeszcze postaci.</p>}</section>
    <ItemCatalog />
  </>;
}
