import { formatDice } from '../../lib/dice';
import { StatisticsTab } from './StatisticsTab';
import { CharacterGameInfo } from '../characters/CharacterGameInfo';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AdvancementTab } from './AdvancementTab';
import { api, type Character, type InventoryItem } from '../../api';
import slots from '../../../shared/equipment-slots.json';
import { TransferItemDialog } from './TransferItemDialog';
import { CombatTab } from './CombatTab';
import { weaponDamage } from '../../lib/weapons';
import { ChoicesTab } from './ChoicesTab';

export function GamePage({ character: initialCharacter, onBack }: { character: Character; onBack: () => void }) {
  const [character, setCharacter] = useState(initialCharacter);
  const updateCharacter = useCallback((next: Character) => setCharacter(previous => ({ ...previous, ...next })), []);
  const [activeTab, setActiveTab] = useState<'equipment' | 'statistics' | 'combat' | 'choices' | 'advancement'>('equipment');
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [selectedSlot, setSelectedSlot] = useState('armor');
  const heading = useRef<HTMLHeadingElement>(null);
  const equipmentDialog = useRef<HTMLDialogElement>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [transferItem, setTransferItem] = useState<InventoryItem | null>(null);
  const inventoryPath = `/characters/${character.id}/inventory`;
  useEffect(() => {
    let alive = true;
    const refresh = () => { void api<{ characters: Character[] }>('/characters').then(data => { const next = data.characters.find(c => c.id === initialCharacter.id); if (alive && next) updateCharacter(next); }).catch(() => {}); };
    refresh();
    const timer = window.setInterval(refresh, 20000);
    window.addEventListener('focus', refresh);
    return () => { alive = false; window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [initialCharacter.id, updateCharacter]);
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
  function itemAction(item: InventoryItem, action: 'equip' | 'unequip' | 'delete', grip?: 'one' | 'two' | 'none', targetSlot?: string) {
    if (action === 'delete' && !window.confirm(`Usunąć „${item.name}” z ekwipunku?`)) return;
    const equipSlot = targetSlot ?? (item.weapon ? item.weapon.type === 'dystansowa' ? 'belt' : 'main-hand' : item.armor?.category === 'shield' ? 'off-hand' : item.armor ? 'armor' : item.slot);
    if (action === 'equip') setSelectedSlot(equipSlot);
    const requestedGrip = item.weapon?.type === 'dystansowa' ? 'none' : grip ?? 'one';
    void mutate(`${inventoryPath}/${item.id}/${action}`, action === 'equip' ? { grip: requestedGrip, slot: item.weapon?.type === 'wręczna' ? equipSlot : undefined } : {}, action === 'equip' ? 'Przedmiot założony. Poprzedni przedmiot z tego slotu wrócił do plecaka.' : action === 'unequip' ? 'Przedmiot przeniesiony do plecaka.' : 'Przedmiot usunięty.').then(success => { if (success) equipmentDialog.current?.close(); });
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
  const availableItems = backpack.filter(item => item.weapon
    ? item.weapon.type === 'dystansowa'
      ? selectedSlot === 'belt'
      : (selectedSlot === 'main-hand' || (selectedSlot === 'off-hand' && item.weapon.properties.includes('lekka') && !item.weapon.properties.some(property => property.startsWith('dwuręczna'))))
    : item.armor ? (item.armor.category === 'shield' ? selectedSlot === 'off-hand' : selectedSlot === 'armor') : item.slot === selectedSlot);
  const slot = slots.find(entry => entry.id === selectedSlot) ?? slots.find(entry => entry.id === 'main-hand')!;

  return <>
    <button className="text-button" onClick={onBack}>← Moje postacie</button>
    <header className="page-heading game-heading"><div><p className="eyebrow">TWOJA PRZYGODA</p><h1 ref={heading} tabIndex={-1}>{character.name}</h1><p>{[character.species, character.class, character.subclass].filter(Boolean).join(' · ')}</p><CharacterGameInfo character={character} /></div><span className="level-badge">Poziom <strong>{character.level}</strong></span></header>
    {!!character.pendingAdvancement && <p role="status" className="inventory-message">Możesz awansować na poziom {character.level + 1}! <button className="text-button" onClick={() => setActiveTab('advancement')}>Rozwiń postać</button></p>}
    <nav className="game-tabs" aria-label="Zakładki postaci">{([{ id: 'equipment', label: 'Ekwipunek', symbol: '⛨' }, { id: 'statistics', label: 'Statystyki', symbol: '◈' }, { id: 'combat', label: 'Walka', symbol: '⚔' }, { id: 'choices', label: 'Wybory', symbol: '◇' }, { id: 'advancement', label: 'Rozwój', symbol: '↑' }] as const).map(tab => <button key={tab.id} className={`game-tab ${activeTab === tab.id ? 'is-active' : ''}`} aria-current={activeTab === tab.id ? 'page' : undefined} aria-controls={`character-${tab.id}`} onClick={() => setActiveTab(tab.id)}><span aria-hidden="true">{tab.symbol}</span> {tab.label}</button>)}</nav>
    <div id="character-advancement" hidden={activeTab !== 'advancement'}>{activeTab === 'advancement' && <AdvancementTab characterId={character.id} onChanged={updateCharacter} />}</div>
    <div id="character-statistics" hidden={activeTab !== 'statistics'}><StatisticsTab key={character.level} character={character} /></div>
    <div id="character-combat" hidden={activeTab !== 'combat'}><CombatTab character={character} active={activeTab === 'combat'} equippedItems={equipped} /></div>
    <div id="character-choices" hidden={activeTab !== 'choices'}><ChoicesTab character={character} active={activeTab === 'choices'} /></div>
    <div id="character-equipment" hidden={activeTab !== 'equipment'}>
    {error && <p role="alert" className="form-error">{error}</p>}
    {message && <p role="status" className="inventory-message">{message}</p>}
    {transferItem && <TransferItemDialog characterId={character.id} item={transferItem} onClose={() => setTransferItem(null)} onTransferred={() => {
      setTransferItem(null);
      setError('');
      setMessage('Przedmiot przekazany do plecaka odbiorcy.');
      void load().catch(() => setError('Przedmiot został przekazany, ale nie udało się odświeżyć plecaka. Wejdź ponownie na ekran postaci.'));
    }} />}
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
          {pending && <p role="status">Zapisywanie wyposażenia…</p>}<p className="eyebrow">WYBRANY SLOT</p><span className="detail-symbol" aria-hidden="true">{slot.symbol}</span><h2 id="selected-slot-heading">{slot.label}</h2>{selectedItem ? <><h2>{selectedItem.name}</h2>{selectedItem.weapon && <p><strong>Obrażenia: {weaponDamage(selectedItem)}</strong> · {selectedItem.grip === 'none' ? 'slot zasięgowy' : selectedItem.grip === 'two' ? 'dwie ręce' : 'jedna ręka'}</p>}<p>{selectedItem.weight == null ? 'Waga: —' : `Waga: ${selectedItem.weight} lb`} · Wartość: {selectedItem.cost || '—'}</p><p>{formatDice(selectedItem.description || 'Brak dodatkowego opisu.')}</p><p>Ilość: {selectedItem.quantity}</p><button className="text-button" disabled={pending} onClick={() => itemAction(selectedItem, 'unequip')}>Zdejmij do plecaka ↓</button></> : <p>Ten slot jest pusty.</p>}
          <div className="slot-picker"><h4>{selectedItem ? 'Zamień na przedmiot z plecaka' : 'Załóż z plecaka'}</h4>
            {availableItems.length ? <ul className="slot-picker-list">{availableItems.map(item => <li key={item.id}><span className="slot-picker-option"><span className="slot-picker-name">{item.name} <small>×{item.quantity}</small></span>{item.weapon && <span className="slot-picker-description">Obrażenia: {item.weapon.damage} · {item.weapon.properties.join(', ') || 'brak właściwości'}</span>}{item.description && <span className="slot-picker-description">{formatDice(item.description)}</span>}<span className="slot-picker-action">{selectedSlot === 'main-hand' && item.weapon?.properties.some(property => property.startsWith('wszechstronna (')) ? <><button className="text-button" disabled={pending} onClick={() => itemAction(item, 'equip', 'one', selectedSlot)}>Jedna ręka</button><button className="text-button" disabled={pending} onClick={() => itemAction(item, 'equip', 'two', selectedSlot)}>Dwie ręce</button></> : <button className="text-button" disabled={pending} onClick={() => itemAction(item, 'equip', item.weapon?.type === 'dystansowa' ? 'none' : item.weapon?.properties.some(property => property.startsWith('dwuręczna')) ? 'two' : 'one', selectedSlot)}>Załóż →</button>}</span></span></li>)}</ul> : <p>W plecaku nie ma przedmiotów pasujących do tego slotu.</p>}
          </div>
        </div></dialog>
      </section>
      <section className="backpack-section" aria-labelledby="backpack-heading"><div className="inventory-section-heading"><div><p className="eyebrow">WSZYSTKO POD RĘKĄ</p><h2 id="backpack-heading">Plecak <span className="item-count">{backpack.length}</span></h2></div></div>
        {backpack.length ? <ul className="inventory-list">{backpack.map(item => <li key={item.id}><div className="inventory-item-icon" aria-hidden="true">{slots.find(entry => entry.id === item.slot)?.symbol ?? '▣'}</div>                <div className="inventory-item-info"><h3>{item.name} <span>×{item.quantity}</span></h3><p>{item.weight == null ? 'Waga: —' : `Waga: ${item.weight} lb`} · Wartość: {item.cost || '—'}</p><p>{item.weapon ? `Broń ${item.weapon.type} · Obrażenia ${item.weapon.damage}` : formatDice(item.description || (slots.find(entry => entry.id === item.slot)?.label ?? 'Przedmiot w plecaku'))}</p></div><div className="admin-actions">{(item.weapon || item.slot !== 'backpack') && <button className="text-button" disabled={pending} onClick={() => itemAction(item, 'equip', item.weapon?.properties.some(property => property.includes('dwuręczna')) ? 'two' : 'one')}>Załóż ↑</button>}<button className="text-button" disabled={pending} onClick={() => setTransferItem(item)} aria-haspopup="dialog" aria-label={`Przekaż ${item.name} innej postaci`}>Przekaż →</button><button className="text-button danger-button" disabled={pending} onClick={() => itemAction(item, 'delete')} aria-label={`Usuń ${item.name}`}>Usuń</button></div></li>)}</ul> : <div className="inventory-empty"><span aria-hidden="true">▣</span><h3>Plecak jest pusty</h3><p>Tutaj pojawią się przedmioty przydzielone postaci.</p></div>}
      </section>
    </>}
    </div>
  </>;
}
