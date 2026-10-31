import { useEffect, useState, type ReactNode } from 'react';
import { api, type Character, type CharacterStatistics } from '../../api';
import { weaponMasteryCount, weapons } from '../../../shared/weapon-mastery.mjs';

export function ChoicesTab({ character, active }: { character: Character; active: boolean }) {
  const [choices, setChoices] = useState<string[]>([]);
  const [draft, setDraft] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const count = weaponMasteryCount(character);
  useEffect(() => {
    if (!active) return;
    api<{ statistics: CharacterStatistics }>(`/characters/${character.id}/statistics`)
      .then(({ statistics }) => { setChoices(statistics.choices?.weaponMastery ?? []); setError(''); })
      .catch(e => setError(e instanceof Error ? e.message : 'Nie udało się wczytać wyborów.'));
  }, [character.id, active]);
  function update(index: number, value: string) {
    setDraft(previous => {
      const next = [...(previous.length ? previous : choices)];
      next[index] = value;
      return next;
    });
  }
  async function save() {
    const values = (draft.length ? draft : choices).filter(Boolean);
    if (new Set(values).size !== values.length) { setError('Każda broń może być wybrana tylko raz.'); return; }
    setPending(true); setError(''); setMessage('');
    try {
      await api(`/characters/${character.id}/choices`, { weaponMastery: values });
      setChoices(values); setDraft([]); setMessage('Wybory zapisane.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Nie udało się zapisać wyborów.'); }
    finally { setPending(false); }
  }
  if (!count) return <Cardless heading="Wybory"><p className="statistics-help">Ta postać nie ma obecnie wyborów zależnych od odpoczynku.</p></Cardless>;
  const values = draft.length ? draft : choices;
  return <section className="statistics-tab">
    <div className="inventory-section-heading"><div><p className="eyebrow">ODNAWIANE PODCZAS ODPOCZYNKU</p><h2>Wybory</h2></div></div>
    {error && <p className="form-error" role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    <section className="card"><h3>Co Long Rest</h3><p className="statistics-help">Po długim odpoczynku możesz zmienić jedną z wybranych broni. Wybierz do {count} broni z katalogu.</p>
      <div className="statistics-fields">{Array.from({ length: count }, (_, index) => <label key={index}>Broń {index + 1}<select value={values[index] ?? ''} disabled={pending} onChange={event => update(index, event.target.value)}><option value="">Nie wybrano</option>{weapons.map(weapon => <option key={weapon.id} value={weapon.id} disabled={values.includes(weapon.id) && values[index] !== weapon.id}>{weapon.name} — {weapon.mastery}</option>)}</select></label>)}</div>
      <button className="primary-button" disabled={pending} onClick={() => void save()}>{pending ? 'Zapisywanie…' : 'Zapisz wybory'}</button>
    </section>
    <section className="card"><h3>Co Short Rest</h3><p className="statistics-help">Brak wyborów zależnych od krótkiego odpoczynku dla tej postaci.</p></section>
  </section>;
}

function Cardless({ heading, children }: { heading: string; children: ReactNode }) {
  return <section className="statistics-tab"><h2>{heading}</h2>{children}</section>;
}
