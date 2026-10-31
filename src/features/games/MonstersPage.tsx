import { useEffect, useState } from 'react';
import { Card } from '../../components/ui/Card';
import definitions from '../../../shared/statistics.json' with { type: 'json' };
import { blankEnemy, saveMonster, readMonsters, type Enemy } from './monster-library';

export function MonstersPage({ gameId, userId, gameName }: { gameId: number; userId: number; gameName: string }) {
  const [monsters, setMonsters] = useState<Enemy[]>([]);
  const [draft, setDraft] = useState<Enemy | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    async function load() {
      try { setMonsters(await readMonsters(userId, gameId)); setReady(true); setError(''); }
      catch { setReady(false); setError('Nie udało się odczytać katalogu potworów.'); }
    }
    load();
    window.addEventListener('storage', load);
    window.addEventListener('focus', load);
    return () => { window.removeEventListener('storage', load); window.removeEventListener('focus', load); };
  }, [gameId, userId]);
  async function saveChange(action: 'create' | 'update' | 'delete', monster: Enemy, message: string) {
    if (pending) return false;
    setPending(true);
    try {
      setMonsters(await saveMonster(gameId, action, monster));
      setError(''); setMessage(message); return true;
    } catch (e) { setError(e instanceof Error ? e.message : 'Błąd zapisu.'); return false; }
    finally { setPending(false); }
  }
  return <>
    <header className="page-heading"><a className="text-button" href={`?gmGame=${gameId}`}>← Wróć do gry</a><p className="eyebrow">{gameName} / POTWORY</p><h1>Potwory</h1><p>Zarządzaj potworami tej gry i wybieraj je przy przygotowaniu walki.</p><button className="primary-button" disabled={!ready || pending} onClick={() => { setDraft(blankEnemy()); setMessage(''); }}>Dodaj potwora</button></header>
    {error && <p className="form-error" role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    {draft && <Card title={monsters.some(m => m.id === draft.id) ? 'Edytuj potwora' : 'Nowy potwór'}><form className="stack-form" onSubmit={async e => {
      e.preventDefault(); const monster = { ...draft, name: draft.name.trim() };
      if (!monster.name) { setError('Podaj nazwę potwora.'); return; }
      const editing = monsters.some(m => m.id === monster.id);
      if (await saveChange(editing ? 'update' : 'create', monster, 'Potwór zapisany.')) setDraft(null);
    }}>
      <label>Nazwa<input required maxLength={80} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
      <div className="battle-fields">{(['hp', 'ac', 'speed'] as const).map(field => <label key={field}>{({ hp: 'Maksymalne PW', ac: 'Klasa pancerza', speed: 'Szybkość (stopy)' })[field]}<input required type="number" min={field === 'hp' ? 1 : 0} max={9999} value={draft[field]} onChange={e => setDraft({ ...draft, [field]: Number(e.target.value) })} /></label>)}</div>
      <div className="battle-fields">{definitions.abilities.map(a => <label key={a.id}>Rzut obronny: {a.short}<input required type="number" min={-30} max={40} value={draft.saves[a.id]} onChange={e => setDraft({ ...draft, saves: { ...draft.saves, [a.id]: Number(e.target.value) } })} /></label>)}</div>
      <label>Ataki, obrażenia, zdolności i odporności<textarea maxLength={5000} value={draft.notes} onChange={e => setDraft({ ...draft, notes: e.target.value })} /></label>
      <div className="battle-toolbar"><button className="primary-button" disabled={pending}>Zapisz potwora</button><button type="button" className="text-button" onClick={() => setDraft(null)}>Anuluj</button></div>
    </form></Card>}
    <div className="stack-form"><label>Wyszukaj potwora<input type="search" value={query} onChange={e => setQuery(e.target.value)} /></label></div>
    <p>{monsters.length} potworów w grze</p>
    {ready && !monsters.length && <p>Ta gra nie ma jeszcze potworów. Użyj przycisku „Dodaj potwora”.</p>}
    {ready && monsters.length > 0 && !monsters.some(m => m.name.toLocaleLowerCase('pl').includes(query.toLocaleLowerCase('pl'))) && <p>Brak potworów pasujących do wyszukiwania.</p>}
    <div className="session-characters gm-character-row">{monsters.filter(m => m.name.toLocaleLowerCase('pl').includes(query.toLocaleLowerCase('pl'))).map(m => <Card key={m.id} title={m.name}>
      <dl className="gm-vitals"><div><dt>Maksymalne PW</dt><dd>{m.hp}</dd></div><div><dt>Klasa pancerza</dt><dd>{m.ac}</dd></div><div><dt>Szybkość (stopy)</dt><dd>{m.speed}</dd></div></dl>
      <dl className="gm-secondary gm-exploration">{definitions.abilities.map(a => <div key={a.id}><dt>Rzut obronny: {a.short}</dt><dd>{m.saves[a.id] >= 0 ? '+' : ''}{m.saves[a.id]}</dd></div>)}</dl>
      {m.notes && <p className="item-description">{m.notes}</p>}
      <div className="battle-toolbar"><button className="text-button" aria-label={`Edytuj: ${m.name}`} onClick={() => { setDraft({ ...m, saves: { ...m.saves } }); setMessage(''); }}>Edytuj</button><button className="text-button danger-button" aria-label={`Usun: ${m.name}`} disabled={pending} onClick={async () => {
        if (window.confirm(`Usunąć potwora „${m.name}” z tej gry? Uczestnicy już przygotowanych walk pozostaną bez zmian.`) && await saveChange('delete', m, 'Potwór usunięty.')) { if (draft?.id === m.id) setDraft(null); }
      }}>Usuń</button></div>
    </Card>)}</div>
  </>;
}
