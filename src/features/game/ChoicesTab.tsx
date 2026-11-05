import { useEffect, useState, type ReactNode } from 'react';
import { api, type Character, type CharacterStatistics } from '../../api';
import { weaponMasteryCount, weapons } from '../../../shared/weapon-mastery.mjs';
import { fightingStyleCount, fightingStyles } from '../../../shared/fighting-style.mjs';
import { wizardCantrips } from '../../../shared/fighting-style.mjs';

export function ChoicesTab({ character, active }: { character: Character; active: boolean }) {
  const [abilityScores, setAbilityScores] = useState<Record<string, number | null>>({});
  const [choices, setChoices] = useState<string[]>([]);
  const [fightingStyle, setFightingStyle] = useState('');
  const [fastCrafting, setFastCrafting] = useState('');
  const [fastCraftingOptions, setFastCraftingOptions] = useState<{ value: string; name: string; toolLabel: string }[]>([]);
  const [hasCrafter, setHasCrafter] = useState(false);
  const [draftFightingStyle, setDraftFightingStyle] = useState('');
  const [draftArcaneWarrior, setDraftArcaneWarrior] = useState({ cantrips: ['', ''], ability: '' });
  const [draft, setDraft] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const count = weaponMasteryCount(character);
  const hasFightingStyle = fightingStyleCount(character) > 0;
  useEffect(() => {
    if (!active) return;
    setHasCrafter(character.background === 'Rzemieślnik (Artisan)');
    api<{ statistics: CharacterStatistics }>(`/characters/${character.id}/statistics`)
      .then(({ statistics }) => {
        setAbilityScores(statistics.values);
        setChoices(statistics.choices?.weaponMastery ?? []);
        setFightingStyle(statistics.choices?.fightingStyle ?? '');
        setFastCrafting(statistics.choices?.fastCrafting ?? '');
        const savedArcaneWarrior = statistics.choices?.arcaneWarrior ?? { cantrips: [], ability: '' };
        setDraftArcaneWarrior({ cantrips: [savedArcaneWarrior.cantrips[0] ?? '', savedArcaneWarrior.cantrips[1] ?? ''], ability: savedArcaneWarrior.ability });
        setDraftFightingStyle('');
        setFastCraftingOptions([]);
        void api<{ choices: CharacterStatistics['choices']; fastCraftingOptions?: { value: string; name: string; toolLabel: string }[]; hasCrafter?: boolean }>(`/characters/${character.id}/choices`)
          .then(data => {
            setFastCraftingOptions(data.fastCraftingOptions ?? []);
            setHasCrafter(data.hasCrafter === true);
          })
          .catch(e => setError(e instanceof Error ? e.message : 'Nie udało się wczytać tabeli Szybkie wytwarzanie.'));
        setError('');
      })
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
      const selectedStyle = draftFightingStyle || fightingStyle;
      const selectedArcaneWarrior = draftArcaneWarrior;
      if (selectedStyle === 'arcane-warrior' && (selectedArcaneWarrior.cantrips.some(value => !value) || new Set(selectedArcaneWarrior.cantrips).size !== 2 || !selectedArcaneWarrior.ability)) {
        setError('Wybierz dwie różne sztuczki i cechę czarowania dla Arcane Warrior.'); return;
      }
      await api(`/characters/${character.id}/choices`, { weaponMastery: values, fightingStyle: selectedStyle, arcaneWarrior: selectedArcaneWarrior, fastCrafting });
      setChoices(values); setDraft([]); setFightingStyle(selectedStyle); setDraftFightingStyle(''); setDraftArcaneWarrior(selectedArcaneWarrior); setMessage('Wybory zapisane.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Nie udało się zapisać wyborów.'); }
    finally { setPending(false); }
  }
  const hasFastCrafting = hasCrafter;
  if (!count && !hasFightingStyle && !hasFastCrafting) return <Cardless heading="Wybory"><p className="statistics-help">Ta postać nie ma obecnie wyborów zależnych od odpoczynku ani awansu.</p></Cardless>;
  const values = draft.length ? draft : choices;
  const selectedStyle = fightingStyles.find(style => style.id === (draftFightingStyle || fightingStyle));
  const selectedStyleId = draftFightingStyle || fightingStyle;
  const modifier = (ability: string) => {
    const score = abilityScores[ability];
    return score == null ? '—' : `${score} (${score >= 10 ? '+' : ''}${Math.floor((score - 10) / 2)})`;
  };
  const updateArcaneCantrip = (index: number, value: string) => setDraftArcaneWarrior(previous => {
    const cantrips = [...previous.cantrips];
    cantrips[index] = value;
    return { ...previous, cantrips };
  });
  return <section className="statistics-tab">
    <div className="inventory-section-heading"><div><p className="eyebrow">ODNAWIANE PODCZAS ODPOCZYNKU</p><h2>Wybory</h2></div></div>
    {error && <p className="form-error" role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {hasFightingStyle && <section className="card"><h3>Co level up</h3><p className="statistics-help">Wybierz atut Fighting Style. Przy kolejnym poziomie wojownika możesz zastąpić go innym atutem Fighting Style.</p>
      <label>Fighting Style<select value={draftFightingStyle || fightingStyle} disabled={pending} onChange={event => setDraftFightingStyle(event.target.value)}><option value="">Nie wybrano</option>{fightingStyles.map(style => <option key={style.id} value={style.id}>{style.name}</option>)}</select></label>
      {selectedStyle && <p className="statistics-help"><strong>{selectedStyle.name}</strong>: {selectedStyle.description}</p>}
      {selectedStyleId === 'arcane-warrior' && <div className="statistics-fields">
        {draftArcaneWarrior.cantrips.map((cantripId, index) => {
          const cantrip = wizardCantrips.find(spell => spell.id === cantripId);
          return <div key={index}><label>Sztuczka {index + 1}<select value={cantripId} disabled={pending} onChange={event => updateArcaneCantrip(index, event.target.value)}>
            <option value="">Wybierz sztuczkę…</option>
            {wizardCantrips.map(spell => <option key={spell.id} value={spell.id} disabled={draftArcaneWarrior.cantrips.includes(spell.id) && cantripId !== spell.id}>{spell.name}</option>)}
          </select></label>{cantrip && <p className="statistics-help">{cantrip.description}</p>}</div>;
        })}
        <label>Cecha czarowania<select value={draftArcaneWarrior.ability} disabled={pending} onChange={event => setDraftArcaneWarrior(previous => ({ ...previous, ability: event.target.value }))}>
          <option value="">Wybierz cechę…</option>
          <option value="int">Inteligencja ({modifier('int')})</option>
          <option value="wis">Mądrość ({modifier('wis')})</option>
          <option value="cha">Charyzma ({modifier('cha')})</option>
        </select></label>
      </div>}
      <button className="primary-button" disabled={pending || !(draftFightingStyle || fightingStyle)} onClick={() => void save()}>{pending ? 'Zapisywanie…' : 'Zapisz wybory'}</button>
    </section>}
    {count > 0 && <section className="card"><h3>Co Long Rest</h3><p className="statistics-help">Po długim odpoczynku możesz zmienić jedną z wybranych broni. Wybierz do {count} broni z katalogu.</p>
      <div className="statistics-fields">{Array.from({ length: count }, (_, index) => <label key={index}>Broń {index + 1}<select value={values[index] ?? ''} disabled={pending} onChange={event => update(index, event.target.value)}><option value="">Nie wybrano</option>{weapons.map(weapon => <option key={weapon.id} value={weapon.id} disabled={values.includes(weapon.id) && values[index] !== weapon.id}>{weapon.name} — {weapon.mastery}</option>)}</select></label>)}</div>
      <button className="primary-button" disabled={pending} onClick={() => void save()}>{pending ? 'Zapisywanie…' : 'Zapisz wybory'}</button>
    </section>}
    {count > 0 && <section className="card"><h3>Co Short Rest</h3><p className="statistics-help">Brak wyborów zależnych od krótkiego odpoczynku dla tej postaci.</p></section>}
    {hasFastCrafting && <section className="card"><h3>Co Long Rest</h3><p className="statistics-help">Wybierz jeden przedmiot, który wytworzysz po długim odpoczynku. Przedmiot zostanie dodany do plecaka przy zapisie wyboru.</p>
      {fastCraftingOptions.length ? <label>Szybkie wytwarzanie<select value={fastCrafting} disabled={pending} onChange={event => setFastCrafting(event.target.value)}><option value="">Nie wytwarzaj</option>{fastCraftingOptions.map(option => <option key={option.value} value={option.value}>{option.name} — {option.toolLabel}</option>)}</select></label>
        : <p className="statistics-help">Wybierz najpierw narzędzia w sekcji Crafter albo dodaj odpowiednie narzędzie do plecaka.</p>}
      <button className="primary-button" disabled={pending || !fastCraftingOptions.length} onClick={() => void save()}>{pending ? 'Zapisywanie…' : 'Zapisz wybory'}</button>
    </section>}
  </section>;
}

function Cardless({ heading, children }: { heading: string; children: ReactNode }) {
  return <section className="statistics-tab"><h2>{heading}</h2>{children}</section>;
}
