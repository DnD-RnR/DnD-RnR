import { formatDice } from '../../lib/dice';
import { useEffect, useState, type FormEvent } from 'react';
import { api, type CatalogItem } from '../../api';
import slots from '../../../shared/equipment-slots.json';
import { Card } from '../../components/ui/Card';

export function ItemCatalog() {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  async function load() { setItems((await api<{ items: CatalogItem[] }>('/items')).items); }
  useEffect(() => { load().catch(e => setError(e.message)).finally(() => setLoading(false)); }, []);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const body = Object.fromEntries(new FormData(form));
    setPending(true); setError(''); setMessage('');
    try {
      await api('/items', body); form.reset();
      setMessage('Przedmiot dodany do katalogu. GM może go przydzielać bohaterom.');
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Błąd połączenia.'); }
    finally { setPending(false); }
  }
  return <section className="player-list"><h2>Katalog przedmiotów</h2><p>Dodawaj przedmioty ręcznie. GM wybiera z tego katalogu ekwipunek dla bohaterów swojej gry.</p>
    {error && <p role="alert" className="form-error">{error}</p>}{message && <p role="status">{message}</p>}
    <Card title="Nowy przedmiot"><form className="stack-form" onSubmit={create}><fieldset disabled={pending || loading}>
      <label>Nazwa<input name="name" required maxLength={80} /></label>
      <label>Opis<textarea name="description" rows={3} maxLength={2000} /></label>
      <label>Miejsce noszenia<select name="slot" defaultValue="backpack"><option value="backpack">Tylko plecak</option>{slots.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
      <button className="primary-button">Dodaj do katalogu</button>
    </fieldset></form></Card>
    {loading ? <p role="status">Wczytywanie katalogu…</p> : items.length ? <ul>{items.map(i => <li key={i.id}><strong>{i.name}</strong><p>{slots.find(s => s.id === i.slot)?.label ?? 'Tylko plecak'}</p><p className="item-description">{formatDice(i.description)}</p></li>)}</ul> : <p>Katalog jest pusty. Dodaj pierwszy przedmiot.</p>}
  </section>;
}
