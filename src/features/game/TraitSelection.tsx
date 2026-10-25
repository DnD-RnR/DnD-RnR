import type { Character, CharacterStatistics } from '../../api';
import { characterTraits, emptyTraitSelection, validateTraitSelection, type TraitSelection as Selection } from '../../../shared/character-traits.mjs';
import definitions from '../../../shared/statistics.json' with { type: 'json' };
import { formatDice } from '../../lib/dice';

type Props = { character: Character; statistics: CharacterStatistics; onChange?: (value: Selection) => void };
export function TraitSelection({ character, statistics, onChange }: Props) {
  const profile = characterTraits(character, statistics);
  const selected = statistics.traits;
  const error = validateTraitSelection(character, statistics);
  const incomplete = profile.groups.filter(group => (selected[group.id]?.length ?? 0) < group.limit);
  return <section className="trait-selection" aria-labelledby="automatic-traits-heading">
    <div className="inventory-section-heading"><div><p className="eyebrow">Z KLASY, GATUNKU I POCHODZENIA</p><h3 id="automatic-traits-heading">Automatyczne wpisy na karcie</h3></div><a href={profile.source} target="_blank" rel="noreferrer" className="text-button">Zasady klasy ↗</a></div>
    <dl className="trait-summary">
      <div><dt>Kości wytrzymałości — łączna pula</dt><dd>{profile.hitDie ? `${profile.hitDiceTotal}k${profile.hitDie}` : '—'}</dd></div>
      <div><dt>Biegłe rzuty obronne</dt><dd>{definitions.abilities.filter(ability => profile.savingThrows.includes(ability.id)).map(ability => ability.label).join(', ') || '—'}</dd></div>
      <div><dt>Szkolenie w pancerzach</dt><dd>{profile.armor.join('; ') || '—'}</dd></div>
      <div><dt>Biegłości w broni</dt><dd>{profile.weapons.join('; ') || '—'}</dd></div>
      <div><dt>Narzędzia i instrumenty</dt><dd>{profile.tools.join(', ') || 'Brak / wybierz poniżej'}</dd></div>
      <div><dt>Języki</dt><dd>{profile.languages.map(language => language.label).join(', ')}</dd></div>
      <div><dt>Atuty pochodzenia</dt><dd>{profile.feats.join(', ') || 'Nie wybrano'}</dd></div>
      <div><dt>Podstawowa szybkość gatunku</dt><dd>{profile.baseSpeed ?? '—'} stóp</dd></div>
      <div><dt>Zmysły</dt><dd>{profile.senses.join('; ') || 'Brak dodatkowych zmysłów'}</dd></div>
      <div><dt>Odporności i ułatwienia</dt><dd>{profile.defenses.join(' ') || 'Brak stałych wpisów'}</dd></div>
      {profile.hpBonus > 0 && <div><dt>Premia do maksymalnych PW</dt><dd>+{profile.hpBonus} z gatunku / atutu Tough</dd></div>}
    </dl>
    {error && <div className="form-error" role="alert"><p>{error}</p>{onChange && <button className="text-button" type="button" onClick={() => onChange(emptyTraitSelection())}>Wyczyść wybory i dostosuj je do obecnej postaci</button>}</div>}
    {incomplete.length > 0 && <p className="statistics-help">Do uzupełnienia: {incomplete.map(group => `${group.label} (${selected[group.id]?.length ?? 0}/${group.limit})`).join(' · ')}{!onChange && '. Otwórz edycję, aby dokonać wyborów.'}</p>}
    {onChange && <div className="trait-choice-grid">{profile.groups.map(group => {
      const values = selected[group.id] ?? [];
      const available = group.options.filter(option => !values.includes(option.id));
      return <div className="trait-choice" key={group.id}><div className="inventory-section-heading"><h4>{group.label}</h4><span className="spell-count">{values.length} / {group.limit}</span></div>
        <ul className="chosen-spells">{values.map(id => <li key={id}><span>{group.options.find(option => option.id === id)?.label ?? id}</span><button className="text-button" type="button" aria-label={`Usuń ${id} z ${group.label}`} onClick={() => onChange({ ...selected, [group.id]: values.filter(value => value !== id) })}>Usuń</button></li>)}</ul>
        <label>Wybierz: {group.label.toLowerCase()}<select value="" disabled={values.length >= group.limit || !available.length} onChange={event => { if (event.target.value) onChange({ ...selected, [group.id]: [...values, event.target.value] }); }}><option value="">{values.length >= group.limit ? 'Wybrano komplet' : 'Wybierz…'}</option>{available.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
      </div>;
    })}</div>}
    {profile.resources.length > 0 && <details className="trait-details"><summary>Zasoby i parametry klasy na poziomie {character.level}</summary><dl className="trait-summary">{profile.resources.map(resource => <div key={resource.name}><dt>{resource.name}</dt><dd>{formatDice(resource.value)}</dd></div>)}</dl><p className="statistics-help">Wartości z tabeli klasy. Zużycie i odzyskiwanie zasobów zapisuj osobno.</p></details>}
    <details className="trait-details"><summary>Zdolności klasy i podklasy ({profile.features.length})</summary><ul className="trait-feature-list">{profile.features.map(feature => <li key={`${feature.source}-${feature.name}`}><a href={feature.url} target="_blank" rel="noreferrer">{feature.name} ↗</a><small>{feature.source} · od {feature.level}. poziomu</small></li>)}</ul></details>
    <p className="statistics-help">Wpisy z zasad przeliczają się po zmianie klasy lub poziomu. Zachowane ręczne dopiski służą dodatkowym atutom i ustaleniom z MG. Warianty gatunku, wybory atutów przy awansie i warunkowe efekty zdolności wymagają osobnego uzupełnienia.</p>
  </section>;
}
