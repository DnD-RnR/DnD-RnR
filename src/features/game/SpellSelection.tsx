import { formatDice } from '../../lib/dice';
import type { Character } from '../../api';
import { emptySpellSelection, spellById, spellcastingProfile, validateSpellSelection, type SpellSelection as Selection } from '../../../shared/spellcasting.mjs';

type Props = { character: Character; value: Selection; traits?: Record<string, string[]>; onChange?: (value: Selection) => void; legacyNotes?: string };

export function SpellSelection({ character, value, traits, onChange, legacyNotes }: Props) {
  const profile = spellcastingProfile(character, value, traits);
  const error = validateSpellSelection(character, value);
  const chosen = value.selections;
  const prepared = profile.groups.find(group => group.id === 'prepared');
  const preparedCount = chosen.prepared?.length ?? 0;
  function remove(groupId: string, id: string) {
    const selections = { ...chosen, [groupId]: (chosen[groupId] ?? []).filter(value => value !== id) };
    if (groupId === 'book') for (const group of profile.groups.filter(group => group.fromBook)) selections[group.id] = (selections[group.id] ?? []).filter(value => value !== id);
    onChange?.({ ...value, selections });
  }
  return <section className="spell-selection" aria-labelledby="spell-selection-heading">
    <div className="inventory-section-heading"><div><p className="eyebrow">MAGIA KLASY · PHB 2024</p><h3 id="spell-selection-heading">Sztuczki i czary</h3></div><a className="text-button" href={profile.source} target="_blank" rel="noreferrer">Zasady klasy ↗</a></div>
    <p className="statistics-help">{profile.groups.length ? 'Listy i limity wynikają z klasy, podklasy i poziomu. Czary przyznane przez zdolności są pokazane osobno i nie zużywają limitu wyboru.' : 'Ta klasa i podklasa nie przyznają obecnie wyboru czarów klasowych.'}</p>
    {error && <div className="form-error" role="alert"><p>{error}</p>{onChange && <button type="button" className="text-button" onClick={() => onChange(emptySpellSelection())}>Wyczyść wybór czarów i dostosuj go do obecnej klasy</button>}</div>}
    {profile.choices.length > 0 && <div className="statistics-fields">{profile.choices.map(choice => onChange ? <label key={choice.id}>{choice.label}<select value={value.choices[choice.id] ?? ''} onChange={event => onChange({ ...value, choices: { ...value.choices, [choice.id]: event.target.value } })}>{choice.options.map(option => <option value={option.id} key={option.id}>{option.label}</option>)}</select></label> : <p key={choice.id}>{choice.label}: <strong>{choice.options.find(option => option.id === value.choices[choice.id])?.label ?? 'Nie wybrano'}</strong></p>)}</div>}
    {prepared && <div className="spell-limits">
      <p><strong>Czary przygotowane: {preparedCount} / {prepared.limit}</strong><br />To łączny limit wybranych czarów ze wszystkich dostępnych kręgów.</p>
      <div className="spell-slots"><span>{profile.pactSlotLevel ? 'Komórki do rzucania — magia paktu:' : 'Maksymalne komórki do rzucania czarów:'}</span>{profile.slots.map((count, index) => count > 0 && <span className="spell-count" key={index}><b>{count}</b> {count === 1 ? 'komórka' : count >= 2 && count <= 4 ? 'komórki' : 'komórek'} {profile.pactSlotLevel || index + 1}. kręgu</span>)}</div>
      <p className="statistics-help">Komórki wydajesz na rzucanie czarów. Ich liczba nie ogranicza liczby różnych czarów danego kręgu na liście przygotowanych.</p>
      {prepared.limit === 6 && profile.slots[0] === 4 && profile.slots[1] === 2 && profile.slots.slice(2).every(count => !count) && <p className="statistics-help">Przykład: możesz przygotować wszystkie 6 czarów z 2. kręgu. Dwie komórki 2. kręgu pozwolą rzucić czar z tego kręgu dwa razy przed odzyskaniem komórek.</p>}
    </div>}
    {profile.automatic.length > 0 && <div className="spell-group"><h4>Przyznane przez zdolności / zawsze przygotowane</h4><ul className="chosen-spells">{profile.automatic.map(spell => <li key={spell.id}><div><a href={spell.url} target="_blank" rel="noreferrer">{spell.name} ↗</a><small>{spell.level === 0 ? 'Sztuczka' : `${spell.level}. krąg`} · {spell.reason}</small></div><span aria-label="Przyznany automatycznie">◆</span></li>)}</ul></div>}
    <div className="spell-groups">{profile.groups.map(group => {
      const selected = chosen[group.id] ?? [];
      const available = group.options.filter(spell => !selected.includes(spell.id) && (!group.fromBook || (chosen.book ?? []).includes(spell.id)));
      const atLimit = group.limit !== null && selected.length >= group.limit;
      return <div className="spell-group" key={group.id}><div className="inventory-section-heading"><h4>{group.label}</h4><span className="spell-count">{selected.length}{group.limit === null ? ' · bez limitu kopiowania' : ` / ${group.limit}`}</span></div>
        {group.hint && <p className="statistics-help">{group.hint}</p>}
        {selected.length ? <ul className="chosen-spells">{selected.map(id => {
          const spell = spellById.get(id);
          return <li key={id}><div>{spell ? <a href={spell.url} target="_blank" rel="noreferrer">{spell.name} ↗</a> : id}<small>{spell?.level === 0 ? 'Sztuczka' : `${spell?.level ?? '?'}. krąg`}</small></div>{onChange && <button className="text-button" type="button" aria-label={`Usuń ${spell?.name ?? id} z ${group.label}`} onClick={() => remove(group.id, id)}>Usuń</button>}</li>;
        })}</ul> : <p className="statistics-help">Nie wybrano czarów.</p>}
        {onChange && <label>Dodaj: {group.label.toLowerCase()}<select value="" disabled={atLimit || !available.length} onChange={event => { if (event.target.value) onChange({ ...value, selections: { ...chosen, [group.id]: [...selected, event.target.value] } }); }}><option value="">{atLimit ? 'Osiągnięto limit' : !available.length ? group.fromBook ? 'Najpierw dodaj pasujące czary do księgi' : 'Brak dostępnych czarów' : 'Wybierz czar…'}</option>{Array.from({ length: 10 }, (_, level) => {
          const options = available.filter(spell => spell.level === level);
          return options.length ? <optgroup key={level} label={level ? `${level}. krąg` : 'Sztuczki'}>{options.map(spell => <option key={spell.id} value={spell.id}>{spell.name}</option>)}</optgroup> : null;
        })}</select></label>}
      </div>;
    })}</div>
    <p className="statistics-help">Limity dotyczą wyboru, nie liczby rzuceń. Zmiany przygotowania i poznawania czarów wykonuj przy odpoczynku lub awansie zgodnie z zasadami klasy. Magia z gatunku, atutów, inwokacji i przedmiotów nie jest częścią tego wyboru klasowego.</p>
    {legacyNotes && <details><summary>Poprzednie notatki o czarach</summary><p className="statistics-note">{formatDice(legacyNotes)}</p></details>}
  </section>;
}
