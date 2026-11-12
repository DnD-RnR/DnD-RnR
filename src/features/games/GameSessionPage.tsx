import { SpellRestControls } from './SpellRestControls';
import { MilestoneControls } from './MilestoneControls';
import { BattlePage } from './BattlePage';
import { MonstersPage } from './MonstersPage';
import { GameMemberCard, type GameMember as Member } from './GameMemberCard';
import { GameEditPanel } from './GameEditPanel';
import { useCallback, useEffect, useState } from 'react';
import { api, type CatalogItem } from '../../api';
import { Card } from '../../components/ui/Card';

type Session = { game: { id: number; name: string; description: string }; members: Member[]; activeSession: { id: number; startedAt: number } | null; activeBattle: { sessionId: number } | null };

export function GameSessionPage({ gameId, userId }: { gameId: number; userId: number }) {
  const [editing, setEditing] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [connectionLost, setConnectionLost] = useState(false);
  const load = useCallback(async () => {
    const [data, i, a] = await Promise.all([
      api<Session>(`/games/${gameId}`),
      api<{ items: CatalogItem[] }>('/items'),
      api<{ armors: Array<{ id: string; name: string; category: 'light' | 'medium' | 'heavy' | 'shield'; weight: number | null; cost: string }> }>('/armors'),
    ]);
    setSession(data); setCatalog([...i.items, ...a.armors.map((armor, index) => ({ id: -(index + 1), name: armor.name, description: '', slot: armor.category === 'shield' ? 'off-hand' : 'armor', weight: armor.weight, cost: armor.cost, armorId: armor.id, armorCategory: armor.category }))]);
  }, [gameId]);
  useEffect(() => {
    if (editing) return;
    let alive = true;
    let running = false;
    let again = false;
    const refresh = async () => {
      if (running) { again = true; return; }
      running = true;
      do {
        again = false;
        try { await load(); }
        catch (e) { if (alive) setError(e instanceof Error ? e.message : 'Błąd połączenia.'); }
        finally { if (alive) setLoading(false); }
      } while (alive && again);
      running = false;
    };
    const events = new EventSource(`/api/games/${gameId}/events`);
    events.onopen = () => { setConnectionLost(false); void refresh(); };
    events.onerror = () => { if (alive) setConnectionLost(true); };
    events.addEventListener('change', () => void refresh());
    void refresh();
    window.addEventListener('focus', refresh);
    return () => { alive = false; events.close(); window.removeEventListener('focus', refresh); };
  }, [load, editing, gameId]);
  useEffect(() => {
    const previous = document.title;
    document.title = session ? `${session.game.name} — GM | DnD RnR` : 'Gra — GM | DnD RnR';
    return () => { document.title = previous; };
  }, [session?.game.name]);
  async function refresh() {
    setPending(true); setError('');
    try { await load(); setMessage('Drużyna odświeżona.'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Błąd połączenia.'); }
    finally { setPending(false); }
  }
  async function changeSession() {
    if (!session || pending) return;
    const current = session.activeSession;
    if (current && !window.confirm('Zakończyć sesję? Wszystkie postacie zakończą w niej udział. Nadal będą należeć do gry.')) return;
    setPending(true); setError(''); setMessage('');
    try {
      await api(`/games/${gameId}/sessions/${current ? 'end' : 'start'}`, current ? { sessionId: current.id } : {});
      setMessage(current ? 'Sesja zakończona.' : 'Sesja rozpoczęta. Właściciele mogą teraz dołączać swoimi postaciami.');
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Błąd połączenia.'); }
    finally { setPending(false); }
  }
  async function kick(member: Member) {
    const current = session?.activeSession;
    if (!current || pending || !window.confirm(`Wyrzucić postać „${member.name}” z bieżącej sesji? Nadal będzie należeć do gry i może ponownie dołączyć do sesji.`)) return;
    setPending(true); setError(''); setMessage('');
    try {
      await api(`/games/${gameId}/sessions/${current.id}/participants/${member.id}/kick`, {});
      setMessage(`Postać „${member.name}” została wyrzucona z sesji.`);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Błąd połączenia.'); }
    finally { setPending(false); }
  }
  const members = session?.members.filter(m => m.status === 'accepted') ?? [];
  const participants = members.filter(m => m.participating);
  const absent = members.filter(m => !m.participating);
  if (new URLSearchParams(window.location.search).get('monsters') === '1' && session) return <MonstersPage key={gameId} gameId={gameId} userId={userId} gameName={session.game.name} />;
  if (new URLSearchParams(window.location.search).get('levelUp') === '1' && session) return <>
    <header className="page-heading"><a className="text-button" href={`?gmGame=${gameId}`}>← Wróć do gry</a><p className="eyebrow">{session.game.name} / ROZWÓJ POSTACI</p><h1>Lvl up</h1></header>
    {error && <p role="alert" className="form-error">{error}</p>}
    {connectionLost && <p role="status">Ponowne łączenie z aktualizacjami gry…</p>}
    <MilestoneControls gameId={gameId} members={session.members} onChanged={load} />
  </>;
  if (new URLSearchParams(window.location.search).get('battle') === '1' && session?.activeSession) return <BattlePage key={session.activeSession.id} gameId={gameId} userId={userId} sessionId={session.activeSession.id} members={session.members} />;
  if (editing) return <GameEditPanel gameId={gameId} onBack={() => { setEditing(false); void refresh(); }} />;
  return <>
    <header className="page-heading"><p className="eyebrow">PANEL GM / GRA</p><div className="gm-game-heading"><h1>{session?.game.name ?? 'Gra'}</h1>{!loading && session && <div className={`gm-session-controls ${session.activeSession ? 'is-active' : 'is-inactive'}`}><span role="status">{session.activeSession ? 'Sesja trwa' : 'Sesja nieaktywna'}</span><button className="primary-button" disabled={pending} onClick={() => void changeSession()}>{session.activeSession ? 'Zako\u0144cz sesj\u0119' : 'Rozpocznij sesj\u0119'}</button></div>}</div><div className="admin-actions"><button className="text-button" disabled={pending || loading} onClick={() => void refresh()}>Odśwież drużynę</button><button className="text-button" disabled={pending || loading || !session} onClick={() => setEditing(true)}>{'Edytuj gr\u0119'}</button></div></header>
    {error && <p role="alert" className="form-error">{error}</p>}
    {connectionLost && <p role="status">Ponowne łączenie z aktualizacjami gry… Możesz użyć „Odśwież drużynę”.</p>}
    {message && <p role="status">{message}</p>}
    {loading ? <p role="status">Wczytywanie gry…</p> : session && <>
      <div className="battle-toolbar"><a className="primary-button battle-start" href={`?gmGame=${gameId}&monsters=1`}>Potwory</a><a className="primary-button battle-start" href={`?gmGame=${gameId}&levelUp=1`}>Lvl up</a>{session.activeSession && <a className="primary-button battle-start" href={`?gmGame=${gameId}&battle=1`}>{session.activeBattle ? 'Wr\u00f3\u0107 do walki' : 'Rozpocznij walk\u0119'}</a>}</div>
      {session.activeSession && !session.activeBattle && <SpellRestControls gameId={gameId} />}<section aria-labelledby="participants-heading"><h2 id="participants-heading">Postacie w bieżącej sesji ({participants.length})</h2>
        <p>Do gry należy {members.length} postaci. Poniżej widać tylko te, które weszły do trwającej sesji. Lista aktualizuje się po zmianach.</p>
        {participants.length ? <div className="session-characters gm-character-row">{participants.map(m => <GameMemberCard key={m.id} member={m} gameId={gameId} catalog={catalog} pending={pending} onAssigned={load} onKick={() => void kick(m)} />)}</div> : <Card title="Drużyna czeka na bohaterów"><p>{session.activeSession ? 'Żadna postać nie weszła jeszcze do bieżącej sesji.' : 'Rozpocznij sesję, aby gracze mogli dołączyć.'}</p></Card>}
      </section>
      {!!absent.length && <details className="player-list"><summary>{'Postacie nale\u017c\u0105ce do gry poza sesj\u0105'} ({absent.length})</summary><div className="session-characters gm-character-row">{absent.map(m => <GameMemberCard key={m.id} member={m} gameId={gameId} catalog={catalog} pending={pending} onAssigned={load} />)}</div></details>}

    </>}
  </>;
}
