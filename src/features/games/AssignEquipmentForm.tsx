import { formatDice } from '../../lib/dice';
import { useId, useState, type FormEvent } from 'react';
import { api, type CatalogItem } from '../../api';
import slots from '../../../shared/equipment-slots.json';

type Props = { gameId: number; characterId: number; characterName: string; items: CatalogItem[]; disabled: boolean; onAssigned: () => Promise<void> };
export function AssignEquipmentForm({ gameId, characterId, characterName, items, disabled, onAssigned }: Props) {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const [itemId, setItemId] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const item = items.find(i => i.id === Number(itemId));
  async function assign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || disabled) return;
    const quantity = Number(new FormData(event.currentTarget).get('quantity'));
    setPending(true); setError(''); setMessage('');
    try {
      await api(`/games/${gameId}/equipment`, { characterId, ...(item?.armorId ? { armorId: item.armorId } : { itemId: Number(itemId) }), quantity });
      setMessage('Przedmiot dodany do plecaka.');
      try { await onAssigned(); } catch { setError('Przedmiot został przydzielony, ale nie udało się odświeżyć drużyny. Użyj przycisku „Odśwież drużynę”.'); }
    } catch (e) { setError(e instanceof Error ? e.message : 'Błąd połączenia.'); }
    finally { setPending(false); }
  }
  return <div className="equipment-assignment">
    <button type="button" className="text-button" aria-expanded={expanded} aria-controls={panelId} disabled={pending || disabled} onClick={() => setExpanded(!expanded)}>{expanded ? 'Zwiń przydział ekwipunku' : 'Przydziel ekwipunek'}</button>
    <div id={panelId} hidden={!expanded}>
    {error && <p role="alert" className="form-error">{error}</p>}{message && <p role="status">{message}</p>}
    {items.length ? <form className="stack-form" onSubmit={assign} aria-label={`Przydziel ekwipunek: ${characterName}`}><fieldset disabled={pending || disabled}>
      <label>Przedmiot z katalogu<select required value={itemId} onChange={e => setItemId(e.target.value)}><option value="" disabled>Wybierz przedmiot</option>{items.map(i => <option key={i.id} value={i.id}>{i.name} — {i.armorId ? i.armorCategory === 'shield' ? 'Druga ręka / plecak' : 'Pancerz / plecak' : slots.find(s => s.id === i.slot)?.label ?? 'Tylko plecak'}</option>)}</select></label>
      {item && <><p>{item.weight == null ? 'Waga: —' : `Waga: ${item.weight} lb`} · Wartość: {item.cost || '—'}</p><p className="item-description">{formatDice(item.description || 'Brak opisu.')}</p></>}
      <label>Liczba sztuk<input type="number" name="quantity" min={1} max={9999} step={1} defaultValue={1} required /></label>
      <button className="primary-button" disabled={!item}>{pending ? 'Przydzielanie…' : 'Dodaj do plecaka'}</button>
    </fieldset></form> : <p>Katalog jest pusty. Administrator musi najpierw dodać przedmioty.</p>}
    </div>
  </div>;
}
