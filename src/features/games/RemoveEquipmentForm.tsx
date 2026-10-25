import { useId, useState, type FormEvent } from 'react';
import { api, type InventoryItem } from '../../api';

export function RemoveEquipmentForm({ gameId, characterId, characterName, item, disabled, onRemoved }: {
  gameId: number; characterId: number; characterName: string; item: InventoryItem; disabled: boolean; onRemoved: () => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const panelId = useId();
  async function remove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || disabled) return;
    const quantity = Number(new FormData(event.currentTarget).get('quantity'));
    if (!window.confirm(`Usunąć ${quantity} szt. „${item.name}” z ekwipunku postaci „${characterName}”?`)) return;
    setPending(true); setError(''); setMessage('');
    try {
      await api(`/games/${gameId}/equipment/remove`, { characterId, itemId: item.id, quantity });
      setMessage(`Usunięto ${quantity} szt.`); setExpanded(false);
      try { await onRemoved(); } catch { setError('Przedmiot usunięty. Nie udało się odświeżyć widoku — użyj „Odśwież drużynę”.'); }
    } catch (e) { setError(e instanceof Error ? e.message : 'Błąd połączenia.'); }
    finally { setPending(false); }
  }
  return <>
    <button type="button" className="text-button danger-button" disabled={pending || disabled} aria-expanded={expanded} aria-controls={panelId} onClick={() => setExpanded(!expanded)} aria-label={`Usuń przedmiot ${item.name} postaci ${characterName}`}>{expanded ? 'Anuluj usuwanie' : 'Usuń przedmiot'}</button>
    {error && <p role="alert" className="form-error">{error}</p>}{message && <p role="status">{message}</p>}
    <div id={panelId} hidden={!expanded}><form className="stack-form" onSubmit={remove}><fieldset disabled={pending || disabled}>
      <label>Liczba sztuk do usunięcia<input name="quantity" type="number" min={1} max={item.quantity} step={1} defaultValue={1} required /></label>
      <button className="text-button danger-button">{pending ? 'Usuwanie…' : 'Usuń wybraną ilość'}</button>
    </fieldset></form></div>
  </>;
}
