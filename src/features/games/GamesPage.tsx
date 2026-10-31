import { GameEditPanel } from './GameEditPanel';
import { useEffect, useState, type FormEvent } from 'react';
import { api, type User } from '../../api';
import { Card } from '../../components/ui/Card';

type Game = { id: number; name: string; description: string; gmName: string; activeBattleSessionId?: number | null };
type Invitation = { id: number; gameName: string; gmName: string; characterName: string };

export function GamesPage({ user }: { user: User }) {
  const [editingGameId, setEditingGameId] = useState<number | null>(null);
  const [games, setGames] = useState<Game[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  async function load() {
    const [g, i] = await Promise.all([api<{ games: Game[] }>('/games'), api<{ invitations: Invitation[] }>('/invitations')]);
    setGames(g.games); setInvitations(i.invitations);
  }
  useEffect(() => { load().catch(e => setError(e.message)).finally(() => setLoading(false)); }, []);
  async function act(work: () => Promise<void>, success: string) {
    setPending(true); setError(''); setMessage('');
    try { await work(); setMessage(success); }
    catch (e) { setError(e instanceof Error ? e.message : 'Błąd połączenia.'); }
    finally { setPending(false); }
  }
  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = Object.fromEntries(new FormData(form));
    void act(async () => { await api('/games', body); form.reset(); await load(); }, 'Gra utworzona. Możesz zaprosić bohaterów.');
  }
  function openGame(game: Game) {
    const url = new URL(window.location.href);
    url.search = '';
    url.hash = '';
    url.searchParams.set('gmGame', String(game.id));
    if (game.activeBattleSessionId) url.searchParams.set('battle', '1');
    window.location.assign(url.href);
  }
  if (editingGameId !== null && user.role === 'gm') return <GameEditPanel key={editingGameId} gameId={editingGameId} onBack={() => { setEditingGameId(null); void load().catch(e => setError(e.message)); }} />;
  return <>
    <header className="page-heading"><p className="eyebrow">WSPÓLNE PRZYGODY</p><h1>{user.role === 'gm' ? 'Twoje gry' : 'Gry i zaproszenia'}</h1><p>{user.role === 'gm' ? 'Twórz gry i zapraszaj bohaterów. Karty i ekwipunek zobaczysz po zgodzie gracza.' : 'Zaakceptuj zaproszenie, aby dołączyć bohaterem do gry i udostępnić jego kartę oraz ekwipunek GM.'}</p></header>
    <p>Postać może uczestniczyć tylko w jednej grze na raz.</p>
    {error && <p role="alert" className="form-error">{error}</p>}
    {message && <p role="status">{message}</p>}
    {loading ? <p role="status">Wczytywanie gier…</p> : <>
      {user.role === 'gm' && <Card title="Nowa gra"><form className="stack-form" onSubmit={create}><fieldset disabled={pending}><label>Nazwa gry<input name="name" required maxLength={80} /></label><label>Opis<textarea name="description" maxLength={2000} rows={3} /></label><button className="primary-button">Utwórz grę</button></fieldset></form></Card>}
      {!!invitations.length && <section className="player-list"><h2>Zaproszenia</h2><ul>{invitations.map(i => <li key={i.id}><strong>{i.gameName}</strong><p>GM: {i.gmName} · Bohater: {i.characterName}</p><p>Akceptacja udostępni GM dane tej postaci i jej ekwipunek.</p><div className="admin-actions"><button className="primary-button" disabled={pending} onClick={() => void act(async () => { await api(`/invitations/${i.id}/accept`, {}); await load(); }, 'Zaproszenie zaakceptowane.')}>Akceptuj</button><button className="text-button" disabled={pending} onClick={() => void act(async () => { await api(`/invitations/${i.id}/decline`, {}); await load(); }, 'Zaproszenie odrzucone.')}>Odrzuć</button></div></li>)}</ul></section>}
      <section className="player-list"><h2>Gry</h2>{games.length ? <ul>{games.map(g => <li key={g.id}><strong>{g.name}</strong><p>{g.description}</p><p>GM: {g.gmName}</p>{user.role === 'gm' && <div className="admin-actions"><button className="text-button" disabled={pending} onClick={() => openGame(g)}>{g.activeBattleSessionId ? 'Wr\u00f3\u0107 do walki' : 'Otw\u00f3rz gr\u0119'}</button><button className="text-button" disabled={pending} onClick={() => setEditingGameId(g.id)}>{'Edytuj gr\u0119'}</button></div>}</li>)}</ul> : <p>Nie masz jeszcze żadnej gry.</p>}</section>

    </>}
  </>;
}
