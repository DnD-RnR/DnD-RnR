import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '../../api';
import { Card } from '../../components/ui/Card';

type Member = { id: number; name: string; playerName: string; status: 'pending' | 'accepted' | 'declined' };
type Candidate = { id: number; name: string; playerName: string };
type Game = { id: number; name: string };
const statuses = { pending: 'Oczekuje na akceptację', accepted: 'W grze', declined: 'Zaproszenie odrzucone' };

export function GameEditPanel({ gameId, onBack }: { gameId: number; onBack: () => void }) {
  const [game, setGame] = useState<Game | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const load = useCallback(async () => {
    const [data, c] = await Promise.all([api<{ game: Game; members: Member[] }>(`/games/${gameId}`), api<{ characters: Candidate[] }>(`/games/${gameId}/candidates`)]);
    setGame(data.game); setMembers(data.members); setCandidates(c.characters);
  }, [gameId]);
  useEffect(() => { load().catch(e => setError(e.message)).finally(() => setLoading(false)); }, [load]);
  async function refresh() {
    setPending(true); setError(''); setMessage('');
    try { await load(); } catch (e) { setError(e instanceof Error ? e.message : 'Błąd połączenia.'); }
    finally { setPending(false); }
  }
  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const characterId = Number(new FormData(event.currentTarget).get('characterId'));
    setPending(true); setError(''); setMessage('');
    try {
      await api(`/games/${gameId}/invitations`, { characterId });
      setMessage('Zaproszenie wysłane. Czekamy na decyzję właściciela postaci.');
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Błąd połączenia.'); }
    finally { setPending(false); }
  }
  async function remove(member: Member) {
    if (pending || !window.confirm(`Usunąć postać „${member.name}” z gry? Postać i jej ekwipunek pozostaną na koncie właściciela. Ponowne dołączenie będzie wymagało nowego zaproszenia i akceptacji.`)) return;
    setPending(true); setError(''); setMessage('');
    try {
      await api(`/games/${gameId}/members/${member.id}/remove`, {});
      setMessage(`Postać „${member.name}” została usunięta z gry.`);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Błąd połączenia.'); }
    finally { setPending(false); }
  }
  const participants = members.filter(m => m.status === 'accepted');
  const invitations = members.filter(m => m.status !== 'accepted');
  return <>
    <button className="text-button" disabled={pending} onClick={onBack}>← Wróć</button>
    <header className="page-heading"><p className="eyebrow">PANEL GM / EDYCJA GRY</p><h1>{game?.name ?? 'Edycja gry'}</h1><p>Zarządzaj postaciami i zaproszeniami do tej gry.</p></header>
    {error && <p className="form-error" role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {loading ? <p role="status">Wczytywanie zaproszeń…</p> : <>
      <button className="text-button" disabled={pending} onClick={() => void refresh()}>Odśwież zaproszenia</button>
      {game && <><Card title="Zaproś bohatera"><form className="stack-form" onSubmit={invite}><fieldset disabled={pending || !candidates.length}><label>Bohater do zaproszenia<select name="characterId" required defaultValue=""><option value="" disabled>Wybierz bohatera</option>{candidates.map(c => <option key={c.id} value={c.id}>{c.name} — {c.playerName}</option>)}</select></label><button className="primary-button">Zaproś do gry</button></fieldset></form>{!candidates.length && <p>Brak kolejnych bohaterów do zaproszenia.</p>}</Card>
        <section className="player-list"><h2>Postacie w grze ({participants.length})</h2>{participants.length ? <ul>{participants.map(m => <li key={m.id}><div className="admin-row"><div><strong>{m.name}</strong><p>Właściciel: {m.playerName}</p></div><button className="text-button danger-button" disabled={pending} onClick={() => void remove(m)} aria-label={`Usuń postać ${m.name} z gry`}>Usuń z gry</button></div></li>)}</ul> : <p>Brak postaci w grze.</p>}</section>
        <section className="player-list"><h2>Wysłane zaproszenia</h2>{invitations.length ? <ul>{invitations.map(m => <li key={m.id}><strong>{m.name}</strong><p>Właściciel: {m.playerName} · {statuses[m.status]}</p></li>)}</ul> : <p>Brak oczekujących lub odrzuconych zaproszeń.</p>}</section>
      </>}
    </>}
  </>;
}
