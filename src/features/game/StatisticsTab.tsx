import { formatDice } from '../../lib/dice';
import { TraitSelection } from './TraitSelection';
import { characterTraits } from '../../../shared/character-traits.mjs';
import { rageProfile, dangerSenseDescription } from '../../../shared/barbarian.mjs';
import { SpellSelection } from './SpellSelection';
import { spellcastingProfile } from '../../../shared/spellcasting.mjs';
import { useEffect, useState, type FormEvent } from 'react';
import { api, type Character, type CharacterStatistics } from '../../api';
import definitions from '../../../shared/statistics.json' with { type: 'json' };

const signed = (value: number | null) => value === null ? '—' : value >= 0 ? `+${value}` : String(value);
const display = (value: number | null) => value ?? '—';

export function StatisticsTab({ character }: { character: Character }) {
  const [statistics, setStatistics] = useState<CharacterStatistics | null>(null);
  const [draft, setDraft] = useState<CharacterStatistics | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const path = `/characters/${character.id}/statistics`;
  useEffect(() => {
    let active = true;
    api<{ statistics: CharacterStatistics }>(path).then(data => { if (active) setStatistics(data.statistics); }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [path]);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !draft) return;
    setPending(true); setError(''); setMessage('');
    try {
      const result = await api<{ statistics: CharacterStatistics }>(path, draft);
      setStatistics(result.statistics); setDraft(null); setMessage('Statystyki zapisane.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Nie udało się zapisać statystyk.'); }
    finally { setPending(false); }
  }
  const stats = draft ?? statistics;
  if (!stats) return error ? <p role="alert" className="form-error">{error}</p> : <p role="status">Wczytywanie statystyk…</p>;
  const traits = characterTraits(character, stats);
  const proficiency = 2 + Math.floor((character.level - 1) / 4);
  const modifier = (id: string) => stats.values[id] == null ? null : Math.floor((stats.values[id]! - 10) / 2);
  const bonus = (ability: string, rank: number) => { const mod = modifier(ability); return mod === null ? null : mod + proficiency * rank; };
  const dex = modifier('dex');
  const spellAbility = spellcastingProfile(character, stats.spells, stats.traits).ability || stats.spellAbility;
  const spellMod = spellAbility ? modifier(spellAbility) : null;
  const skillBonus = (id: string, ability: string) => { const base = bonus(ability, traits.effectiveSkills[id]); const extra = traits.skillBonuses[id]; return base === null || extra === null ? null : base + extra; };
  const perception = skillBonus('perception', 'wis');
  function numberField(id: string, label: string, min: number, max: number) {
    return <label key={id}>{label}<input type="number" min={min} max={max} placeholder={id === 'speed' && traits.baseSpeed !== null ? String(traits.baseSpeed) : id === 'maxHp' && traits.firstLevelMaxHp !== null ? String(traits.firstLevelMaxHp) : undefined} value={stats!.values[id] ?? ''} onChange={event => {
      const value = event.target.value === '' ? null : event.target.valueAsNumber;
      setDraft(previous => previous && ({ ...previous, values: { ...previous.values, [id]: value } }));
    }} /></label>;
  }
  return <div className="statistics-tab">
    <div className="inventory-section-heading"><div><p className="eyebrow">KARTA BOHATERA</p><h2>Statystyki</h2></div>{!draft && <button className="primary-button" onClick={() => { setDraft(structuredClone(stats)); setMessage(''); setError(''); }}>Uzupełnij / edytuj</button>}</div>
    {error && <p className="form-error" role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {rageProfile(character).dangerSense && <p>{dangerSenseDescription}</p>}
    {rageProfile(character).primalKnowledge && <p>Primal Knowledge: wybierz dodatkową biegłość z listy umiejętności barbarzyńcy w sekcji cech postaci. W Szale możesz używać Siły do Akrobatyki, Zastraszania, Percepcji, Skradania się i Sztuki przetrwania, zachowując biegłość lub ekspertyzę oraz ułatwienie Szału.</p>}
    {draft ? <form className="stack-form statistics-editor" onSubmit={save}><fieldset disabled={pending}>
      <legend>Wartości z karty postaci</legend><p>Wpisuj wartości cech. KP jest wyliczana automatycznie. Pusta szybkość korzysta z wartości gatunku, a maksymalne PW na 1. poziomie są liczone z klasy, Kondycji i stałych premii. Wpisana ręcznie wartość PW ma pierwszeństwo i powinna już uwzględniać premie.</p>
      <h3>Cechy</h3><div className="statistics-fields">{definitions.abilities.map(field => numberField(field.id, field.label, 1, 30))}</div>
      <label>Podstawa klasy pancerza<select value={draft.armorClassBase ?? 'class'} onChange={event => setDraft({ ...draft, armorClassBase: event.target.value as 'standard' | 'class' })}><option value="standard">Standardowa: 10 + modyfikator Zręczności</option><option value="class">Z klasy: Obrona bez pancerza (jeśli dostępna)</option></select></label>
      <p>Założona zbroja określa podstawę KP. Obrona bez pancerza barbarzyńcy dodaje Kondycję, a mnicha — Mądrość i wymaga braku tarczy. Różne podstawy KP nie sumują się. Brak wymaganej cechy oznacza brak wyniku KP.</p>
      <h3>Walka i zasoby</h3><div className="statistics-fields">{definitions.numbers.filter(field => field.id !== 'ac').map(field => numberField(field.id, field.label, field.min, field.max))}</div>
      <p>Cecha bazowa magii klasy: <strong>{definitions.abilities.find(ability => ability.id === spellAbility)?.label ?? 'Nie dotyczy'}</strong></p>
      <SpellSelection character={character} value={draft.spells} traits={draft.traits} onChange={spells => setDraft({ ...draft, spells })} legacyNotes={draft.notes.spells} />
      <TraitSelection character={character} statistics={draft} onChange={traits => setDraft({ ...draft, traits })} />
      <details className="trait-details"><summary>Dodatkowe biegłości i ekspertyzy spoza automatycznych wpisów</summary><p>Używaj tych pól dla dodatkowych atutów, efektów i ustaleń z MG. Zwykłe wybory klasy wykonuj w sekcji automatycznych wpisów.</p>
      <h3>Dodatkowe biegłości w rzutach obronnych</h3><div className="statistics-checks">{definitions.abilities.map(ability => <label key={ability.id}><input type="checkbox" checked={draft.savingThrows.includes(ability.id)} onChange={event => setDraft({ ...draft, savingThrows: event.target.checked ? [...draft.savingThrows, ability.id] : draft.savingThrows.filter(id => id !== ability.id) })} />{ability.label}</label>)}</div>
      <h3>Umiejętności</h3><div className="statistics-fields">{definitions.skills.map(skill => <label key={skill.id}>{skill.label}<select value={draft.skills[skill.id]} onChange={event => setDraft({ ...draft, skills: { ...draft.skills, [skill.id]: Number(event.target.value) } })}><option value={0}>Bez biegłości</option><option value={1}>Biegłość</option><option value={2}>Ekspertyza</option></select></label>)}</div>
      </details>
      <h3>Zdolności i pozostałe informacje</h3><div className="statistics-fields">{definitions.notes.filter(note => note.id !== 'spells').map(note => <label key={note.id}>{['languages', 'proficiencies', 'features', 'defenses', 'senses', 'resources'].includes(note.id) ? 'Dodatkowe: ' : ''}{note.label}<textarea rows={3} maxLength={1500} value={draft.notes[note.id]} onChange={event => setDraft({ ...draft, notes: { ...draft.notes, [note.id]: event.target.value } })} /></label>)}</div>
      <div className="admin-actions"><button className="primary-button">{pending ? 'Zapisywanie…' : 'Zapisz statystyki'}</button><button type="button" className="text-button" onClick={() => { setDraft(null); setError(''); }}>Anuluj</button></div>
    </fieldset></form> : <>
      <p className="statistics-help">Kreska oznacza brak danych. Modyfikatory i premie wynikają z zapisanych cech, poziomu i zaznaczonych biegłości.</p>
      <div className="ability-grid">{definitions.abilities.map(ability => <section className="ability-card" key={ability.id} aria-label={ability.label}><span>{ability.label}</span><strong>{signed(modifier(ability.id))}</strong><small>{ability.short} <b>{display(stats.values[ability.id])}</b></small></section>)}</div>
      <section className="card statistics-combat"><h3>Walka i przetrwanie</h3><dl className="statistics-metrics">
        <div><dt>Punkty wytrzymałości</dt><dd>{display(stats.values.hp)} / {display(stats.values.maxHp ?? traits.firstLevelMaxHp)}</dd></div>
        <div><dt>Tymczasowe PW</dt><dd>{display(stats.values.tempHp)}</dd></div>
        <div><dt>Klasa pancerza</dt><dd>{display(stats.values.ac)}</dd></div>
        <div><dt>Inicjatywa</dt><dd>{signed(dex === null ? null : dex + traits.initiativeBonus + (stats.values.initiativeBonus ?? 0))}</dd></div>
        <div><dt>Szybkość</dt><dd>{display(stats.values.speed ?? traits.baseSpeed)} stóp</dd></div>
        <div><dt>Premia z biegłości</dt><dd>{signed(proficiency)}</dd></div>
        <div><dt>Pasywna Percepcja</dt><dd>{perception === null ? '—' : 10 + perception}</dd></div>
        <div><dt>Kości wytrzymałości — pozostałe / łącznie</dt><dd>{stats.values.hitDice === null ? '—' : `${stats.values.hitDice}k${traits.hitDie ?? '?'}`} / {traits.hitDie ? `${character.level}k${traits.hitDie}` : '—'}</dd></div>
        <div><dt>Przeciw śmierci: sukcesy / porażki</dt><dd>{display(stats.values.deathSuccesses)} / {display(stats.values.deathFailures)}</dd></div>
        <div><dt>Wyczerpanie</dt><dd>{display(stats.values.exhaustion)}</dd></div>
        <div><dt>Heroiczna inspiracja</dt><dd>{stats.values.inspiration === null ? '—' : stats.values.inspiration ? 'Tak' : 'Nie'}</dd></div>
        <div><dt>Doświadczenie</dt><dd>{display(stats.values.xp)} PD</dd></div>
      </dl></section>
      <div className="dashboard-grid"><section className="card"><h3>Rzuty obronne</h3><ul className="statistics-list">{definitions.abilities.map(ability => <li key={ability.id}><span>{ability.label}{traits.effectiveSavingThrows.includes(ability.id) && <small>Biegłość</small>}</span><strong>{signed(bonus(ability.id, traits.effectiveSavingThrows.includes(ability.id) ? 1 : 0))}</strong></li>)}</ul></section>
      <section className="card"><h3>Umiejętności</h3><ul className="statistics-list">{definitions.skills.map(skill => <li key={skill.id}><span>{skill.label} <small>{definitions.abilities.find(ability => ability.id === skill.ability)?.short} · {traits.effectiveSkills[skill.id] === 2 ? 'Ekspertyza' : traits.effectiveSkills[skill.id] === 1 ? 'Biegłość' : 'Bez biegłości'}{skill.id === 'stealth' && stats.stealthDisadvantage ? ' · utrudnienie od zbroi' : ''}{(traits.skillBonuses[skill.id] ?? 0) > 0 ? ` · premia ze zdolności +${traits.skillBonuses[skill.id]}` : ''}{traits.skillSources[skill.id] ? ` · ${traits.skillSources[skill.id]}` : ''}</small></span><strong>{signed(skillBonus(skill.id, skill.ability))}</strong></li>)}</ul></section></div>
      <section className="card"><h3>Magia</h3><dl className="statistics-metrics"><div><dt>Cecha bazowa</dt><dd>{definitions.abilities.find(ability => ability.id === spellAbility)?.label ?? '—'}</dd></div><div><dt>Atak czarem</dt><dd>{signed(spellMod === null ? null : spellMod + proficiency + (stats.values.spellBonus ?? 0))}</dd></div><div><dt>ST rzutu przeciw czarom</dt><dd>{spellMod === null ? '—' : 8 + proficiency + spellMod + (stats.values.spellDcBonus ?? 0)}</dd></div></dl></section>
      <SpellSelection character={character} value={stats.spells} legacyNotes={stats.notes.spells} />
      <TraitSelection character={character} statistics={stats} />
      <div className="dashboard-grid">{definitions.notes.filter(note => note.id !== 'spells' && (stats.notes[note.id] || ['attacks', 'conditions'].includes(note.id))).map(note => <section className="card" key={note.id}><h3>{['languages', 'proficiencies', 'features', 'defenses', 'senses', 'resources'].includes(note.id) ? 'Dodatkowe: ' : ''}{note.label}</h3><p className="statistics-note">{formatDice(stats.notes[note.id] || 'Nie uzupełniono.')}</p></section>)}</div>
      {(stats.untrainedArmor || stats.untrainedShield || stats.spellcastingBlocked) && <p className="form-error">Brak biegłości w założonym wyposażeniu: {stats.untrainedArmor && 'utrudnienie testów Siły i Zręczności oraz brak możliwości rzucania czarów'}{stats.untrainedArmor && stats.untrainedShield && '; '}{stats.untrainedShield && 'tarcza nie zapewnia premii do KP'}.</p>}
      <p className="statistics-help">Wartości uwzględniają podstawowe obliczenia. Warunkowe premie, skutki stanów i wyposażenia uwzględniaj na karcie; nie są naliczane automatycznie.</p>
    </>}
  </div>;
}
