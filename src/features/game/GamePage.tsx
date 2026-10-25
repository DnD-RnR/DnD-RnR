import { useEffect, useRef, useState } from 'react';
import { api, type Character, type InventoryItem } from '../../api';
import slots from '../../../shared/equipment-slots.json';

export function GamePage({ character, onBack }: { character: Character; onBack: () => void }) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [selectedSlot, setSelectedSlot] = useState('armor');
  const heading = useRef<HTMLHeadingElement>(null);
  const equipmentDialog = useRef<HTMLDialogElement>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const inventoryPath = `/characters/${character.id}/inventory`;
  async function load() {
    const data = await api<{ items: InventoryItem[] }>(inventoryPath);
    setItems(data.items);
  }
  useEffect(() => {
    heading.current?.focus();
    load().catch(e => setError(e.message)).finally(() => setLoading(false));
  }, [character.id]);
  async function mutate(path: string, body: unknown, success: string) {
    if (pending) return;
    setPending(true); setError(''); setMessage('');
    try {
      await api(path, body);
      await load();
      setMessage(success);
      return true;
    } catch (e) { setError(e instanceof Error ? e.message : 'Nie udało się zapisać ekwipunku.'); }
    finally { setPending(false); }
    return false;
  }
  function itemAction(item: InventoryItem, action: 'equip' | 'unequip' | 'delete') {
    if (action === 'delete' && !window.confirm(`Usunąć „${item.name}” z ekwipunku?`)) return;
    if (action === 'equip') setSelectedSlot(item.slot);
    void mutate(`${inventoryPath}/${item.id}/${action}`, {}, action === 'equip' ? 'Przedmiot założony. Poprzedni przedmiot z tego slotu wrócił do plecaka.' : action === 'unequip' ? 'Przedmiot przeniesiony do plecaka.' : 'Przedmiot usunięty.').then(success => { if (success) equipmentDialog.current?.close(); });
  }
  function selectSlot(slotId: string) {
    setSelectedSlot(slotId);
    setError('');
    setPickerOpen(true);
    equipmentDialog.current?.showModal();
  }
  const equipped = items.filter(item => item.equipped);
  const backpack = items.filter(item => !item.equipped);
  const selectedItem = equipped.find(item => item.slot === selectedSlot);
  const availableItems = backpack.filter(item => item.slot === selectedSlot);
  const slot = slots.find(entry => entry.id === selectedSlot)!;

  return <>
    <button className="text-button" onClick={onBack}>← Moje postacie</button>
    <header className="page-heading game-heading"><div><p className="eyebrow">TWOJA PRZYGODA</p><h1 ref={heading} tabIndex={-1}>{character.name}</h1><p>{[character.species, character.class, character.subclass].filter(Boolean).join(' · ')}</p></div><span className="level-badge">Poziom <strong>{character.level}</strong></span></header>
    <nav className="game-tabs" aria-label="Zakładki gry"><button aria-current="page" className="game-tab is-active"><span aria-hidden="true">⛨</span> Ekwipunek</button></nav>
    {error && <p role="alert" className="form-error">{error}</p>}
    {message && <p role="status" className="inventory-message">{message}</p>}
    {loading ? <p role="status">Wczytywanie ekwipunku…</p> : <>
      <section className="equipment-section" aria-labelledby="equipped-heading">
        <div className="inventory-section-heading"><div><p className="eyebrow">GOTOWOŚĆ DO PRZYGODY</p><h2 id="equipped-heading">Założony ekwipunek</h2></div><span>{equipped.length} / {slots.length} slotów</span></div>
        <div className="equipment-layout"><div className="equipment-stage">
          <div className="character-silhouette" aria-hidden="true"><svg viewBox="0 0 240 520" fill="none"><ellipse cx="120" cy="490" rx="85" ry="13" fill="currentColor" opacity=".12"/><circle cx="120" cy="67" r="34"/><path d="M95 100 65 122 37 263 60 275 92 180 88 290 72 469 103 469 120 320 137 469 168 469 152 290 148 180 180 275 203 263 175 122 145 100 136 113 104 113Z"/><path d="m65 122 55 34 55-34M92 180l28 23 28-23M88 290h64M120 156v134" stroke="currentColor" opacity=".5"/><path d="m79 141-39 301 42-28m79-273 39 301-42-28" stroke="currentColor" opacity=".25"/></svg></div>
          <div className="equipment-slots">{slots.map(entry => {
            const item = equipped.find(value => value.slot === entry.id);
            return <button key={entry.id} className={`equipment-slot slot-${entry.id} ${pickerOpen && selectedSlot === entry.id ? 'is-selected' : ''} ${item ? 'is-equipped' : ''}`} onClick={() => selectSlot(entry.id)} aria-controls="slot-equipment-picker" aria-haspopup="dialog" aria-expanded={pickerOpen && selectedSlot === entry.id} aria-label={`${entry.label}: ${item?.name ?? 'pusty slot'}. Wybierz wyposażenie.`}><span className="slot-symbol" aria-hidden="true">{entry.symbol}</span><span><span className="slot-label">{entry.label}</span><strong>{item?.name ?? 'Pusty slot'}</strong></span></button>;
          })}</div>
        </div>
        </div>
        <dialog ref={equipmentDialog} id="slot-equipment-picker" className="equipment-dialog" aria-labelledby="selected-slot-heading" onClose={() => setPickerOpen(false)} onClick={event => { if (event.target === event.currentTarget) equipmentDialog.current?.close(); }}>
        <div className="slot-details">
          <button type="button" className="text-button dialog-close" aria-label="Zamknij wybór wyposażenia" onClick={() => equipmentDialog.current?.close()}>Zamknij ×</button>
          {error && <p role="alert" className="form-error">{error}</p>}
          {pending && <p role="status">Zapisywanie wyposażenia…</p>}<p className="eyebrow">WYBRANY SLOT</p><span className="detail-symbol" aria-hidden="true">{slot.symbol}</span><h2 id="selected-slot-heading">{slot.label}</h2>{selectedItem ? <><h2>{selectedItem.name}</h2><p>{selectedItem.description || 'Brak dodatkowego opisu.'}</p><p>Ilość: {selectedItem.quantity}</p><button className="text-button" disabled={pending} onClick={() => itemAction(selectedItem, 'unequip')}>Zdejmij do plecaka ↓</button></> : <p>Ten slot jest pusty.</p>}
          <div className="slot-picker"><h4>{selectedItem ? 'Zamień na przedmiot z plecaka' : 'Załóż z plecaka'}</h4>
            {availableItems.length ? <ul className="slot-picker-list">{availableItems.map(item => <li key={item.id}><button className="slot-picker-option" disabled={pending} onClick={() => itemAction(item, 'equip')} aria-label={`Załóż ${item.name}: ${slot.label}`}><span className="slot-picker-name">{item.name} <small>×{item.quantity}</small></span>{item.description && <span className="slot-picker-description">{item.description}</span>}<span className="slot-picker-action">{selectedItem ? 'Zamień →' : 'Załóż →'}</span></button></li>)}</ul> : <p>W plecaku nie ma przedmiotów pasujących do tego slotu.</p>}
          </div>
        </div></dialog>
      </section>
      <section className="backpack-section" aria-labelledby="backpack-heading"><div className="inventory-section-heading"><div><p className="eyebrow">WSZYSTKO POD RĘKĄ</p><h2 id="backpack-heading">Plecak <span className="item-count">{backpack.length}</span></h2></div></div>
        {backpack.length ? <ul className="inventory-list">{backpack.map(item => <li key={item.id}><div className="inventory-item-icon" aria-hidden="true">{slots.find(entry => entry.id === item.slot)?.symbol ?? '▣'}</div><div className="inventory-item-info"><h3>{item.name} <span>×{item.quantity}</span></h3><p>{item.description || (slots.find(entry => entry.id === item.slot)?.label ?? 'Przedmiot w plecaku')}</p></div><div className="admin-actions">{item.slot !== 'backpack' && <button className="text-button" disabled={pending} onClick={() => itemAction(item, 'equip')}>Załóż ↑</button>}<button className="text-button danger-button" disabled={pending} onClick={() => itemAction(item, 'delete')} aria-label={`Usuń ${item.name}`}>Usuń</button></div></li>)}</ul> : <div className="inventory-empty"><span aria-hidden="true">▣</span><h3>Plecak jest pusty</h3><p>Tutaj pojawią się przedmioty przydzielone postaci.</p></div>}
      </section>
    </>}
  </>;
}
