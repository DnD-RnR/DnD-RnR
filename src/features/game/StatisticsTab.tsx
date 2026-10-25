import { useEffect, useState, type FormEvent } from 'react';
import { api, type Character, type CharacterStatistics } from '../../api';
import definitions from '../../../shared/statistics.json';

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
  const proficiency = 2 + Math.floor((character.level - 1) / 4);
  const modifier = (id: string) => stats.values[id] == null ? null : Math.floor((stats.values[id]! - 10) / 2);
  const bonus = (ability: string, rank: number) => { const mod = modifier(ability); return mod === null ? null : mod + proficiency * rank; };
  const dex = modifier('dex');
  const spellMod = stats.spellAbility ? modifier(stats.spellAbility) : null;
  const perception = bonus('wis', stats.skills.perception);
  function numberField(id: string, label: string, min: number, max: number) {
    return <label key={id}>{label}<input type="number" min={min} max={max} value={stats!.values[id] ?? ''} onChange={event => {
      const value = event.target.value === '' ? null : event.target.valueAsNumber;
      setDraft(previous => previous && ({ ...previous, values: { ...previous.values, [id]: value } }));
    }} /></label>;
  }
  return <div className="statistics-tab">
    <div className="inventory-section-heading"><div><p className="eyebrow">KARTA BOHATERA</p><h2>Statystyki</h2></div>{!draft && <button className="primary-button" onClick={() => { setDraft(structuredClone(stats)); setMessage(''); setError(''); }}>Uzupełnij / edytuj</button>}</div>
    {error && <p className="form-error" role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {draft ? <form className="stack-form statistics-editor" onSubmit={save}><fieldset disabled={pending}>
      <legend>Wartości z karty postaci</legend><p>Puste pole oznacza brak danych. Wpisuj końcowe wartości cech i KP, uwzględniające wyposażenie oraz zdolności.</p>
      <h3>Cechy</h3><div className="statistics-fields">{definitions.abilities.map(field => numberField(field.id, field.label, 1, 30))}</div>
      <h3>Walka i zasoby</h3><div className="statistics-fields">{definitions.numbers.map(field => numberField(field.id, field.label, field.min, field.max))}</div>
      <h3>Biegłości w rzutach obronnych</h3><div className="statistics-checks">{definitions.abilities.map(ability => <label key={ability.id}><input type="checkbox" checked={draft.savingThrows.includes(ability.id)} onChange={event => setDraft({ ...draft, savingThrows: event.target.checked ? [...draft.savingThrows, ability.id] : draft.savingThrows.filter(id => id !== ability.id) })} />{ability.label}</label>)}</div>
      <h3>Umiejętności</h3><div className="statistics-fields">{definitions.skills.map(skill => <label key={skill.id}>{skill.label}<select value={draft.skills[skill.id]} onChange={event => setDraft({ ...draft, skills: { ...draft.skills, [skill.id]: Number(event.target.value) } })}><option value={0}>Bez biegłości</option><option value={1}>Biegłość</option><option value={2}>Ekspertyza</option></select></label>)}</div>
      <label>Cecha bazowa magii<select value={draft.spellAbility} onChange={event => setDraft({ ...draft, spellAbility: event.target.value })}><option value="">Nie wybrano / nie dotyczy</option>{definitions.abilities.map(ability => <option key={ability.id} value={ability.id}>{ability.label}</option>)}</select></label>
      <h3>Zdolności i pozostałe informacje</h3><div className="statistics-fields">{definitions.notes.map(note => <label key={note.id}>{note.label}<textarea rows={3} maxLength={1500} value={draft.notes[note.id]} onChange={event => setDraft({ ...draft, notes: { ...draft.notes, [note.id]: event.target.value } })} /></label>)}</div>
      <div className="admin-actions"><button className="primary-button">{pending ? 'Zapisywanie…' : 'Zapisz statystyki'}</button><button type="button" className="text-button" onClick={() => { setDraft(null); setError(''); }}>Anuluj</button></div>
    </fieldset></form> : <>
      <p className="statistics-help">Kreska oznacza brak danych. Modyfikatory i premie wynikają z zapisanych cech, poziomu i zaznaczonych biegłości.</p>
      <div className="ability-grid">{definitions.abilities.map(ability => <section className="ability-card" key={ability.id} aria-label={ability.label}><span>{ability.label}</span><strong>{signed(modifier(ability.id))}</strong><small>{ability.short} <b>{display(stats.values[ability.id])}</b></small></section>)}</div>
      <section className="card statistics-combat"><h3>Walka i przetrwanie</h3><dl className="statistics-metrics">
        <div><dt>Punkty wytrzymałości</dt><dd>{display(stats.values.hp)} / {display(stats.values.maxHp)}</dd></div>
        <div><dt>Tymczasowe PW</dt><dd>{display(stats.values.tempHp)}</dd></div>
        <div><dt>Klasa pancerza</dt><dd>{display(stats.values.ac)}</dd></div>
        <div><dt>Inicjatywa</dt><dd>{signed(dex === null ? null : dex + (stats.values.initiativeBonus ?? 0))}</dd></div>
        <div><dt>Szybkość</dt><dd>{display(stats.values.speed)} stóp</dd></div>
        <div><dt>Premia z biegłości</dt><dd>{signed(proficiency)}</dd></div>
        <div><dt>Pasywna Percepcja</dt><dd>{perception === null ? '—' : 10 + perception}</dd></div>
        <div><dt>Kości wytrzymałości: pozostałe</dt><dd>{display(stats.values.hitDice)} / {character.level}</dd></div>
        <div><dt>Przeciw śmierci: sukcesy / porażki</dt><dd>{display(stats.values.deathSuccesses)} / {display(stats.values.deathFailures)}</dd></div>
        <div><dt>Wyczerpanie</dt><dd>{display(stats.values.exhaustion)}</dd></div>
        <div><dt>Heroiczna inspiracja</dt><dd>{stats.values.inspiration === null ? '—' : stats.values.inspiration ? 'Tak' : 'Nie'}</dd></div>
        <div><dt>Doświadczenie</dt><dd>{display(stats.values.xp)} PD</dd></div>
      </dl></section>
      <div className="dashboard-grid"><section className="card"><h3>Rzuty obronne</h3><ul className="statistics-list">{definitions.abilities.map(ability => <li key={ability.id}><span>{ability.label}{stats.savingThrows.includes(ability.id) && <small>Biegłość</small>}</span><strong>{signed(bonus(ability.id, stats.savingThrows.includes(ability.id) ? 1 : 0))}</strong></li>)}</ul></section>
      <section className="card"><h3>Umiejętności</h3><ul className="statistics-list">{definitions.skills.map(skill => <li key={skill.id}><span>{skill.label} <small>{definitions.abilities.find(ability => ability.id === skill.ability)?.short} · {stats.skills[skill.id] === 2 ? 'Ekspertyza' : stats.skills[skill.id] === 1 ? 'Biegłość' : 'Bez biegłości'}</small></span><strong>{signed(bonus(skill.ability, stats.skills[skill.id]))}</strong></li>)}</ul></section></div>
      <section className="card"><h3>Magia</h3><dl className="statistics-metrics"><div><dt>Cecha bazowa</dt><dd>{definitions.abilities.find(ability => ability.id === stats.spellAbility)?.label ?? '—'}</dd></div><div><dt>Atak czarem</dt><dd>{signed(spellMod === null ? null : spellMod + proficiency + (stats.values.spellBonus ?? 0))}</dd></div><div><dt>ST rzutu przeciw czarom</dt><dd>{spellMod === null ? '—' : 8 + proficiency + spellMod + (stats.values.spellDcBonus ?? 0)}</dd></div></dl></section>
      <div className="dashboard-grid">{definitions.notes.map(note => <section className="card" key={note.id}><h3>{note.label}</h3><p className="statistics-note">{stats.notes[note.id] || 'Nie uzupełniono.'}</p></section>)}</div>
      <p className="statistics-help">Wartości uwzględniają podstawowe obliczenia. Warunkowe premie, skutki stanów i wyposażenia uwzględniaj na karcie; nie są naliczane automatycznie.</p>
    </>}
  </div>;
}
