import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, type InventoryItem } from '../../api';

type Recipient = { id: number; name: string };
type Props = { characterId: number; item: InventoryItem; onClose: () => void; onTransferred: () => void };

export function TransferItemDialog({ characterId, item, onClose, onTransferred }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    dialog.current?.showModal();
    api<{ characters: Recipient[] }>(`/characters/${characterId}/recipients`)
      .then(data => { if (active) setRecipients(data.characters); })
      .catch(e => { if (active) setError(e.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [characterId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const data = new FormData(event.currentTarget);
    setPending(true); setError('');
    try {
      await api(`/characters/${characterId}/inventory/${item.id}/transfer`, {
        recipientId: Number(data.get('recipientId')), quantity: Number(data.get('quantity')),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się przekazać przedmiotu.');
      setPending(false);
      return;
    }
    dialog.current?.close();
    onTransferred();
  }
  return <dialog ref={dialog} className="equipment-dialog" aria-labelledby="transfer-heading" onClose={onClose} onCancel={event => { if (pending) event.preventDefault(); }} onClick={event => { if (!pending && event.target === event.currentTarget) dialog.current?.close(); }}>
    <div className="slot-details">
      <button type="button" className="text-button dialog-close" disabled={pending} onClick={() => dialog.current?.close()}>Zamknij ×</button>
      <p className="eyebrow">Z PLECAKA DO PLECAKA</p><h2 id="transfer-heading">Przekaż przedmiot</h2>
      <h3>{item.name} ×{item.quantity}</h3>
      <p>Wybrana liczba sztuk trafi od razu do plecaka odbiorcy.</p>
      {error && <p role="alert" className="form-error">{error}</p>}
      {loading ? <p role="status">Wczytywanie postaci…</p> : recipients.length ? <form className="stack-form" onSubmit={submit}>
        <fieldset disabled={pending}>
          <label>Postać odbiorcy<select name="recipientId" required defaultValue=""><option value="" disabled>Wybierz postać</option>{recipients.map(recipient => <option key={recipient.id} value={recipient.id}>{recipient.name} (#{recipient.id})</option>)}</select></label>
          <label>Liczba sztuk<input name="quantity" type="number" min={1} max={item.quantity} defaultValue={1} required /></label>
          <button className="primary-button">{pending ? 'Przekazywanie…' : 'Przekaż przedmiot'}</button>
        </fieldset>
      </form> : !error && <p>Nie ma jeszcze innej postaci, której możesz przekazać przedmiot.</p>}
    </div>
  </dialog>;
}
