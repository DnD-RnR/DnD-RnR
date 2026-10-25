import { GameEditPanel } from './GameEditPanel';
import { useCallback, useEffect, useState } from 'react';
import { api, type CatalogItem, type Character, type InventoryItem } from '../../api';
import { Card } from '../../components/ui/Card';
import { AssignEquipmentForm } from './AssignEquipmentForm';

type Member = { id: number; name: string; playerName: string; status: 'pending' | 'accepted' | 'declined'; character?: Character; items?: InventoryItem[] };
type Session = { game: { id: number; name: string; description: string }; members: Member[] };

export function GameSessionPage({ gameId }: { gameId: number }) {
  const [editing, setEditing] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const load = useCallback(async () => {
    const [data, i] = await Promise.all([
      api<Session>(`/games/${gameId}`),
      api<{ items: CatalogItem[] }>('/items'),
    ]);
    setSession(data); setCatalog(i.items);
  }, [gameId]);
  useEffect(() => {
    if (editing) return;
    const refresh = () => { void load().catch(e => setError(e.message)); };
    load().catch(e => setError(e.message)).finally(() => setLoading(false));
    window.addEventListener('focus', refresh);
    const timer = window.setInterval(refresh, 15000);
    return () => { window.removeEventListener('focus', refresh); window.clearInterval(timer); };
  }, [load, editing]);
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
  const participants = session?.members.filter(m => m.status === 'accepted') ?? [];
  if (editing) return <GameEditPanel gameId={gameId} onBack={() => { setEditing(false); void refresh(); }} />;
  return <>
    <header className="page-heading"><p className="eyebrow">PANEL GM / GRA</p><h1>{session?.game.name ?? 'Gra'}</h1>{session?.game.description && <p className="item-description">{session.game.description}</p>}<div className="admin-actions"><button className="text-button" disabled={pending || loading} onClick={() => void refresh()}>Odśwież drużynę</button><button className="text-button" disabled={pending || loading || !session} onClick={() => setEditing(true)}>{'Edytuj gr\u0119'}</button></div></header>
    {error && <p role="alert" className="form-error">{error}</p>}
    {message && <p role="status">{message}</p>}
    {loading ? <p role="status">Wczytywanie gry…</p> : session && <>
      <section aria-labelledby="participants-heading"><h2 id="participants-heading">Postacie w grze ({participants.length})</h2>
        <p>Bohaterowie z zaakceptowanym udziałem. Drużyna odświeża się automatycznie co 15 sekund.</p>
        {participants.length ? <div className="dashboard-grid session-characters">{participants.map(m => <Card key={m.id} title={m.name} eyebrow={`WŁAŚCICIEL: ${m.playerName}`}>
          {m.character && <>
            <p>{[m.character.species, m.character.class, m.character.subclass].filter(Boolean).join(' · ')}</p>
            <p>Poziom <strong>{m.character.level}</strong> · Pochodzenie: {m.character.background || 'Do uzupełnienia'}</p>
            <details className="session-inventory"><summary>Ekwipunek ({m.items?.length ?? 0})</summary>{m.items?.length ? <ul>{m.items.map(item => <li key={item.id}><strong>{item.name}</strong> × {item.quantity} · {item.equipped ? 'Założony' : 'Plecak'}<p className="item-description">{item.description}</p></li>)}</ul> : <p>Brak przedmiotów.</p>}</details>
            <AssignEquipmentForm gameId={gameId} characterId={m.character.id} characterName={m.name} items={catalog} disabled={pending} onAssigned={load} />
          </>}
        </Card>)}</div> : <Card title="Drużyna czeka na bohaterów"><p>Żadna postać nie zaakceptowała jeszcze udziału w tej grze. Zaproś bohaterów w panelu Edytuj grę.</p></Card>}
      </section>

    </>}
  </>;
}
