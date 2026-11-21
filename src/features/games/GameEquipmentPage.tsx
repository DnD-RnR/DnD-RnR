import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError, type CatalogItem, type Weapon } from '../../api';
import { Card } from '../../components/ui/Card';
import { formatDice } from '../../lib/dice';
import { watchLive } from '../../lib/live-sync';
import { MAX_EQUIPMENT_GRANTS, MAX_ITEM_QUANTITY, splitGold } from '../../../shared/equipment.mjs';

type Member = { characterId: number; name: string; playerName: string };
type EquipmentData = {
  game: { name: string };
  members: Member[];
  items: CatalogItem[];
  weapons: Weapon[];
  armors: { id: string; name: string; armorClass: string }[];
};
type CatalogOption = {
  key: string;
  name: string;
  reference: { itemId: number } | { weaponId: string } | { armorId: string };
  details: string;
  description?: string;
};
type LootItem = CatalogOption & { quantity: string };

function catalogOptions(data: EquipmentData) {
  const fromItem = (item: CatalogItem): CatalogOption => ({
    key: `item:${item.id}`, name: item.name, reference: { itemId: item.id }, description: item.description,
    details: [item.weight == null ? '' : `${item.weight} lb`, item.cost].filter(Boolean).join(' · '),
  });
  const items = data.items.filter(item => !item.armorId);
  return [
    { label: 'Przedmioty', options: items.filter(item => !item.weaponId).map(fromItem) },
    { label: 'Broń', options: [
      ...data.weapons.map(weapon => ({
        key: `weapon:${weapon.id}`, name: weapon.name, reference: { weaponId: weapon.id },
        details: `${formatDice(weapon.damage)} · Obrażenia ${weapon.damageType} · Broń ${weapon.type}`,
      })),
      ...items.filter(item => item.weaponId).map(fromItem),
    ] },
    { label: 'Pancerze i tarcze', options: data.armors.map(armor => ({
      key: `armor:${armor.id}`, name: armor.name, reference: { armorId: armor.id }, details: `KP ${armor.armorClass}`,
    })) },
  ];
}

function searchText(value: string) {
  return value.toLocaleLowerCase('pl').normalize('NFD').replace(/\p{M}/gu, '').replaceAll('ł', 'l');
}

export function GameEquipmentPage({ gameId, characterId }: { gameId: number; characterId: number | null }) {
  const [data, setData] = useState<EquipmentData | null>(null);
  const [loadError, setLoadError] = useState('');
  const [selection, setSelection] = useState<number[] | null>(characterId === null ? null : [characterId]);
  const [query, setQuery] = useState('');
  const [choiceKey, setChoiceKey] = useState('');
  const [loot, setLoot] = useState<LootItem[]>([]);
  const [goldInput, setGoldInput] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let active = true;
    const stop = watchLive(async () => {
      try {
        const next = await api<EquipmentData>(`/games/${gameId}/equipment`);
        if (active) { setData(next); setLoadError(''); }
      } catch (e) {
        if (!active) return;
        if (e instanceof ApiError && e.status === 404) setData(null);
        setLoadError(e instanceof Error ? e.message : 'Błąd połączenia.');
      }
    });
    return () => { active = false; stop(); };
  }, [gameId]);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = data ? `Ekwipunek drużyny · ${data.game.name} | DnD RnR` : 'Ekwipunek drużyny | DnD RnR';
    return () => { document.title = previousTitle; };
  }, [data?.game.name]);

  const members = data?.members ?? [];
  const recipients = members.filter(member => selection === null || selection.includes(member.characterId));
  const allSelected = recipients.length === members.length;
  const maxGold = MAX_ITEM_QUANTITY * recipients.length;
  const gold = Number(goldInput);
  const goldValid = Number.isSafeInteger(gold) && gold >= 0 && gold <= maxGold;
  const shares = goldValid && gold > 0 ? splitGold(gold, recipients.length) : [];
  const goldRecipients = shares.filter(Boolean).length;
  const grantCount = loot.length * recipients.length + goldRecipients;
  const lootValid = loot.every(item => {
    const quantity = Number(item.quantity);
    return Number.isInteger(quantity) && quantity >= 1 && quantity <= MAX_ITEM_QUANTITY;
  });
  const canAward = !pending && grantCount > 0 && grantCount <= MAX_EQUIPMENT_GRANTS && goldValid && lootValid;

  const added = new Set(loot.map(item => item.key));
  const search = searchText(query.trim());
  const groups = data ? catalogOptions(data).map(group => ({
    ...group,
    options: group.options.filter(option => !added.has(option.key) && searchText(option.name).includes(search))
      .sort((first, second) => first.name.localeCompare(second.name, 'pl')),
  })).filter(group => group.options.length) : [];
  const options = groups.flatMap(group => group.options);
  const choice = options.length === 1 ? options[0] : options.find(option => option.key === choiceKey);

  function toggleRecipient(id: number) {
    const selectedIds = recipients.map(member => member.characterId);
    setSelection(selectedIds.includes(id) ? selectedIds.filter(selectedId => selectedId !== id) : [...selectedIds, id]);
  }

  function addChoice() {
    if (!choice || pending) return;
    setLoot([...loot, { ...choice, quantity: '1' }]);
    setChoiceKey('');
    setQuery('');
  }

  async function award(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canAward) return;
    setPending(true);
    setError('');
    setMessage('');
    try {
      await api(`/games/${gameId}/equipment/batch`, {
        characterIds: recipients.map(member => member.characterId),
        items: loot.map(item => ({ ...item.reference, quantity: Number(item.quantity) })),
        gold,
      });
      const recipientCount = loot.length ? recipients.length : goldRecipients;
      setMessage(`Dodano łup do plecaków (${recipientCount} postaci).`);
      setLoot([]);
      setGoldInput('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Błąd połączenia.');
    } finally {
      setPending(false);
    }
  }

  return <div className="game-equipment-page">
    <header className="page-heading">
      <a className="text-button" href={`?gmGame=${gameId}`}>← Wróć do gry</a>
      {data && <p className="eyebrow">{data.game.name}</p>}
      <h1>Ekwipunek drużyny</h1>
    </header>
    {loadError && <p role="alert" className="form-error">{loadError}</p>}
    {!data && !loadError && <p role="status">Wczytywanie drużyny i katalogu…</p>}
    {data && !members.length && <Card title="Brak odbiorców"><p>Przydział ekwipunku jest dostępny, gdy przynajmniej jedna postać zaakceptuje zaproszenie do gry.</p></Card>}
    {!!members.length && <form className="stack-form game-equipment-form" onSubmit={award}>
      <Card title="Odbiorcy">
        <fieldset disabled={pending} aria-label="Odbiorcy łupu">
          <div className="equipment-recipient-actions">
            <span>Wybrano {recipients.length} z {members.length}</span>
            <button type="button" className="text-button" onClick={() => setSelection(allSelected ? [] : null)}>
              {allSelected ? 'Wyczyść wybór' : 'Zaznacz wszystkich'}
            </button>
          </div>
          <div className="equipment-recipient-list">
            {members.map(member => <label key={member.characterId}>
              <input type="checkbox" checked={selection === null || selection.includes(member.characterId)} onChange={() => toggleRecipient(member.characterId)} />
              <span><strong>{member.name}</strong><small>{member.playerName}</small></span>
            </label>)}
          </div>
        </fieldset>
      </Card>
      <div className="equipment-award">
        <Card title="Przedmioty i broń">
          <fieldset disabled={pending} aria-label="Przedmioty do rozdania">
            <label>Szukaj w katalogu
              <input type="search" value={query} placeholder="np. długi miecz" onChange={event => { setQuery(event.target.value); setChoiceKey(''); }}
                onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addChoice(); } }} />
            </label>
            <div className="equipment-catalog-picker">
              <label>Pozycja z katalogu
                <select value={choice?.key ?? ''} onChange={event => setChoiceKey(event.target.value)} disabled={!options.length}>
                  <option value="" disabled>{options.length ? 'Wybierz pozycję' : 'Brak pasujących pozycji'}</option>
                  {groups.map(group => <optgroup key={group.label} label={group.label}>
                    {group.options.map(option => <option key={option.key} value={option.key}>{option.name}</option>)}
                  </optgroup>)}
                </select>
              </label>
              <button type="button" className="equipment-add-button" disabled={!choice} onClick={addChoice}>Dodaj pozycję</button>
            </div>
            {!!loot.length && <ul className="equipment-loot-list">
              {loot.map(item => <li key={item.key}>
                <div className="equipment-loot-name">
                  <strong>{item.name}</strong>
                  {item.details && <small>{item.details}</small>}
                  {item.description && <details><summary>Opis</summary><p className="item-description">{formatDice(item.description)}</p></details>}
                </div>
                <label>Sztuk na postać
                  <input type="number" min={1} max={MAX_ITEM_QUANTITY} step={1} required value={item.quantity}
                    aria-label={`Sztuk na postać: ${item.name}`} onChange={event => setLoot(loot.map(entry => entry.key === item.key ? { ...entry, quantity: event.target.value } : entry))} />
                </label>
                <button type="button" className="text-button danger-button" aria-label={`Usuń z przydziału: ${item.name}`} onClick={() => setLoot(loot.filter(entry => entry.key !== item.key))}>Usuń</button>
              </li>)}
            </ul>}
          </fieldset>
        </Card>
        <Card title="Podział złota">
          <fieldset disabled={pending} aria-label="Złoto do rozdania">
            <label>Pula złota (GP)
              <input className="equipment-gold-input" type="number" min={0} max={maxGold} step={1} value={goldInput} placeholder="0" onChange={event => setGoldInput(event.target.value)} />
            </label>
            {!!shares.length && <ul className="equipment-gold-shares" aria-label="Podział złota między postacie">
              {recipients.map((member, index) => <li key={member.characterId}><span>{member.name}</span><strong>{shares[index]} GP</strong></li>)}
            </ul>}
          </fieldset>
        </Card>
        <div className="equipment-award-actions">
          {error && <p role="alert" className="form-error">{error}</p>}
          {message && <p role="status" className="equipment-award-success">{message}</p>}
          {grantCount > MAX_EQUIPMENT_GRANTS && <p className="form-error">W jednym przydziale możesz dodać do {MAX_EQUIPMENT_GRANTS} pozycji we wszystkich plecakach łącznie.</p>}
          {gold > maxGold && recipients.length > 0 && <p className="form-error">Dla wybranych postaci pula może wynosić do {maxGold} GP.</p>}
          <button className="primary-button" disabled={!canAward}>
            {pending ? 'Przydzielanie…' : 'Przydziel łup'}
          </button>
        </div>
      </div>
    </form>}
  </div>;
}
