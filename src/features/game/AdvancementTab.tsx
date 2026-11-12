import { useCallback, useEffect, useState } from 'react';
import { api, type Character, type CharacterStatistics } from '../../api';
import { advancementPreview, advancementSource, hasLevelFeat, levelFeatOptions, type AdvancementDraft } from '../../../shared/advancement.mjs';
import options from '../../../shared/character-options.json';
import definitions from '../../../shared/statistics.json' with { type: 'json' };
import { weaponMasteryCount, weapons } from '../../../shared/weapon-mastery.mjs';
import { fightingStyleCount, fightingStyles, wizardCantrips } from '../../../shared/fighting-style.mjs';
import { SpellSelection } from './SpellSelection';
import { TraitSelection } from './TraitSelection';

export type Advancement = { id: string; characterId: number; characterName?: string; fromLevel: number; toLevel: number; reason: string; gmName: string; grantedAt: number; completedAt?: number; status: 'pending' | 'completed' | 'reverted' | 'cancelled'; version: number; draft: AdvancementDraft; hpGain?: number; features?: string[] };
type Data = { character: Character; statistics: CharacterStatistics; base: string; blockedByBattle: boolean; pending: Advancement | null; history: Advancement[] };
const statusLabel = { pending: 'Oczekuje', completed: 'Ukończony', reverted: 'Cofnięty', cancelled: 'Anulowany' };
export function AdvancementHistory({ entries }: { entries: Advancement[] }) {
  return entries.length ? <ol className="advancement-history">{entries.map(entry => <li key={entry.id}><strong>{entry.fromLevel} → {entry.toLevel} poziom · {statusLabel[entry.status]}</strong><p>{entry.reason}</p><small>{entry.gmName} · {new Date(entry.grantedAt).toLocaleDateString('pl-PL')}</small>{entry.hpGain !== undefined && <p>+{entry.hpGain} maksymalnych PW{entry.draft.featMode === 'feat' && ` · ${entry.draft.feat}`}{Object.entries(entry.draft.increases ?? {}).filter(([, value]) => value).map(([id, value]) => ` · ${definitions.abilities.find(a => a.id === id)?.label} +${value}`)}</p>}{!!entry.features?.length && <p>{entry.features.join(' · ')}</p>}</li>)}</ol> : <p>Historia rozwoju pojawi się po przyznaniu pierwszego awansu przez GM.</p>;
}
export function AdvancementTab({ characterId, onChanged }: { characterId: number; onChanged: (character: Character) => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [draft, setDraft] = useState<AdvancementDraft>({});
  const [step, setStep] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const load = useCallback(async () => {
    const result = await api<Data>(`/characters/${characterId}/advancement`);
    setData(result); setDraft(result.pending?.draft ?? {}); onChanged({ ...result.character, pendingAdvancement: result.pending ? 1 : 0 });
  }, [characterId, onChanged]);
  useEffect(() => { void load().catch(e => setError(e.message)); }, [load]);
  async function submit(complete: boolean) {
    if (!data?.pending || pending) return;
    setPending(true); setError(''); setMessage('');
    try {
      const result = await api<{ pending: Advancement }>(`/characters/${characterId}/advancement/${complete ? 'complete' : 'draft'}`, { id: data.pending.id, version: data.pending.version, base: data.base, draft });
      if (complete) { await load(); setStep(0); setMessage('Awans ukończony. Karta postaci została zaktualizowana.'); }
      else { setData({ ...data, pending: result.pending }); setMessage('Postęp zapisany. Możesz wrócić do kreatora później.'); }
    } catch (e) { setError(e instanceof Error ? e.message : 'Nie udało się zapisać awansu.'); }
    finally { setPending(false); }
  }
  if (!data) return <section className="equipment-section"><h2>Rozwój postaci</h2>{error ? <p role="alert" className="form-error">{error}</p> : <p role="status">Wczytywanie rozwoju…</p>}<button className="text-button" onClick={() => void load().catch(e => setError(e.message))}>Odśwież</button></section>;
  const preview = advancementPreview(data.character, data.statistics, draft);
  const next = preview.character, stats = preview.statistics;
  const choices = stats.choices;
  const subclassOptions = options.classes.find(c => c.name === next.class)?.subclasses ?? [];
  const featOptions = levelFeatOptions(next, data.statistics);
  function update(patch: Partial<AdvancementDraft>) { setDraft(value => ({ ...value, ...patch })); setMessage(''); }
  function updateChoices(patch: Partial<CharacterStatistics['choices']>) { update({ choices: { ...choices, ...patch } }); }
  const steps = ['Punkty wytrzymałości', 'Rozwój i wybory', 'Magia', 'Podsumowanie'];
  return <section className="equipment-section advancement-panel">
    <div className="inventory-section-heading"><div><p className="eyebrow">KAMIENIE MILOWE</p><h2>Rozwój postaci</h2></div><button className="text-button" disabled={pending} onClick={() => { if (window.confirm('Odświeżyć rozwój? Niezapisane wybory kreatora zostaną zastąpione ostatnim zapisem.')) void load().catch(e => setError(e.message)); }}>Odśwież</button></div>
    {error && <p role="alert" className="form-error">{error}</p>}{message && <p role="status">{message}</p>}
    {data.pending ? <>
      <div className="welcome-banner"><div><h3>Możesz awansować na poziom {data.pending.toLevel}!</h3><p>{data.pending.reason}</p><small>Przyznaje: {data.pending.gmName}</small></div></div>
      {data.blockedByBattle && <p role="status">Trwa walka. Możesz zapisać wybory, a awans zatwierdzisz po jej zakończeniu.</p>}
      <nav className="advancement-steps" aria-label="Kroki awansu">{steps.map((label, index) => <button key={label} className="text-button" aria-current={step === index ? 'step' : undefined} disabled={pending} onClick={() => setStep(index)}>{index + 1}. {label}</button>)}</nav>
      <fieldset disabled={pending} className="advancement-fields"><legend>{steps[step]}</legend>
      {step === 0 && <>
        <p>Nowy poziom: {data.character.level} → {next.level} · Kość wytrzymałości: k{preview.hitDie ?? '?'}</p>
        <div className="statistics-fields"><label>Przyrost PW<select value={draft.hpMode ?? 'fixed'} onChange={e => update({ hpMode: e.target.value as 'fixed' | 'roll' })}><option value="fixed">Stała wartość ({preview.hitDie ? preview.hitDie / 2 + 1 : '?'})</option><option value="roll">Rzut własną kością</option></select></label>{draft.hpMode === 'roll' && <label>Wynik k{preview.hitDie}<input type="number" min={1} max={preview.hitDie ?? 12} value={draft.hpRoll ?? ''} onChange={e => update({ hpRoll: Number.isNaN(e.target.valueAsNumber) ? null : e.target.valueAsNumber })} /></label>}</div>
        <p>Przyrost maksymalnych PW: <strong>{preview.hpGain === null ? 'Uzupełnij Kondycję, maksymalne PW i wynik rzutu' : `+${preview.hpGain}`}</strong>. Uwzględniamy Kondycję, jej zmianę za wcześniejsze poziomy oraz premie gatunku i atutów.</p>
        <p>Awans nie leczy i nie odnawia wykorzystanych zasobów. Nowe maksymalne wartości wynikają z poziomu.</p>
      </>}
      {step === 1 && <>
        {data.character.level === 2 && <label>Wybierz podklasę<select value={draft.subclass ?? ''} onChange={e => update({ subclass: e.target.value })}><option value="">Wybierz podklasę…</option>{subclassOptions.map(name => <option key={name}>{name}</option>)}</select></label>}
        {hasLevelFeat(next) && <>
          <label>Nagroda za poziom<select value={draft.featMode ?? 'asi'} onChange={e => update({ featMode: e.target.value as 'asi' | 'feat', feat: '', increases: {} })}><option value="asi">Zwiększenie cech (+2 lub +1/+1, maks. 20)</option><option value="feat">Atut z dostępnego katalogu</option></select></label>
          {draft.featMode === 'feat' ? <><p>Dostępne są obsługiwane atuty pochodzenia bez wyboru magii. Katalog nie obejmuje jeszcze atutów ogólnych i epickich.</p><label>Atut<select value={draft.feat ?? ''} onChange={e => update({ feat: e.target.value })}><option value="">Wybierz atut…</option>{featOptions.map(feat => <option key={feat.name}>{feat.name}</option>)}</select></label><p>{featOptions.find(feat => feat.name === draft.feat)?.description}</p></> : <div className="statistics-fields">{definitions.abilities.map(ability => <label key={ability.id}>{ability.label} ({data.statistics.values[ability.id] ?? 'brak'} → {stats.values[ability.id] ?? 'brak'})<select value={draft.increases?.[ability.id] ?? 0} onChange={e => update({ increases: { ...draft.increases, [ability.id]: Number(e.target.value) } })}>{[0,1,2].map(n => <option key={n} value={n}>+{n}</option>)}</select></label>)}</div>}
        </>}
        {!!weaponMasteryCount(next) && <div className="statistics-fields">{Array.from({ length: weaponMasteryCount(next) }, (_, index) => <label key={index}>Weapon Mastery {index + 1}<select value={choices.weaponMastery[index] ?? ''} onChange={e => { const values = [...choices.weaponMastery]; values[index] = e.target.value; updateChoices({ weaponMastery: values }); }}><option value="">Wybierz broń…</option>{weapons.map(w => <option value={w.id} key={w.id}>{w.name}</option>)}</select></label>)}</div>}
        {!!fightingStyleCount(next) && <label>Fighting Style<select value={choices.fightingStyle} onChange={e => updateChoices({ fightingStyle: e.target.value })}><option value="">Brak / Blessed Warrior</option>{fightingStyles.map(s => <option value={s.id} key={s.id}>{s.name}</option>)}</select></label>}
        {choices.fightingStyle === 'arcane-warrior' && <div className="statistics-fields">{[0,1].map(index => <label key={index}>Sztuczka {index + 1}<select value={choices.arcaneWarrior?.cantrips[index] ?? ''} onChange={e => { const cantrips = [...(choices.arcaneWarrior?.cantrips ?? ['', ''])]; cantrips[index] = e.target.value; updateChoices({ arcaneWarrior: { ability: choices.arcaneWarrior?.ability ?? '', cantrips } }); }}><option value="">Wybierz…</option>{wizardCantrips.map(s => <option value={s.id} key={s.id}>{s.name}</option>)}</select></label>)}<label>Cecha czarowania<select value={choices.arcaneWarrior?.ability ?? ''} onChange={e => updateChoices({ arcaneWarrior: { cantrips: choices.arcaneWarrior?.cantrips ?? [], ability: e.target.value } })}><option value="">Wybierz…</option>{definitions.abilities.filter(a => ['int','wis','cha'].includes(a.id)).map(a => <option value={a.id} key={a.id}>{a.label}</option>)}</select></label></div>}
        <TraitSelection character={next} statistics={stats} onChange={traits => update({ traits })} />
      </>}
      {step === 2 && <>{next.class.includes('Wizard') && <p>Zachowaj dotychczasową księgę i dodaj co najmniej dwa nowe czary za poziom. Uzupełnij też brakujące czary z wcześniejszych poziomów.</p>}<SpellSelection character={next} value={stats.spells} traits={stats.traits} onChange={spells => update({ spells })} /></>}
      {step === 3 && <>
        <dl className="trait-summary"><div><dt>Poziom</dt><dd>{data.character.level} → {next.level}</dd></div><div><dt>Maksymalne PW</dt><dd>{data.statistics.values.maxHp ?? '?'} → {stats.values.maxHp ?? '?'}</dd></div><div><dt>Premia z biegłości</dt><dd>+{2 + Math.floor((data.character.level - 1) / 4)} → +{stats.proficiency}</dd></div><div><dt>Podklasa</dt><dd>{next.subclass || 'Od poziomu 3'}</dd></div></dl>
        <h3>Nowe zdolności</h3>{preview.features.length ? <ul>{preview.features.map(f => <li key={`${f.source}:${f.name}`}><a href={f.url} target="_blank" rel="noreferrer">{f.name}</a>{f.description && <p>{f.description}</p>}</li>)}</ul> : <p>Limity zdolności i zasobów przeliczą się według nowego poziomu.</p>}
        {draft.featMode === 'feat' && <p>Nowy atut: {draft.feat || 'Nie wybrano'}</p>}
        <p>{definitions.abilities.filter(a => stats.values[a.id] !== data.statistics.values[a.id]).map(a => `${a.label}: ${data.statistics.values[a.id]} → ${stats.values[a.id]}`).join(' · ')}</p>
        <SpellSelection character={next} value={stats.spells} traits={stats.traits} />
        <p>Aktualne PW: {data.statistics.values.hp ?? 'nieuzupełnione'} (bez leczenia). Zużyte miejsca czarów i pozostałe zasoby pozostają zapisane.</p>
      </>}
      </fieldset>
      <div className="admin-actions"><button className="text-button" disabled={pending || step === 0} onClick={() => setStep(step - 1)}>Wstecz</button><button className="text-button" disabled={pending} onClick={() => void submit(false)}>Zapisz i dokończ później</button>{step < 3 ? <button className="primary-button" disabled={pending} onClick={() => setStep(step + 1)}>Dalej</button> : <button className="primary-button" disabled={pending || data.blockedByBattle} onClick={() => void submit(true)}>{pending ? 'Zapisywanie…' : 'Zatwierdź awans'}</button>}</div>
      <p><a href={advancementSource} target="_blank" rel="noreferrer">Zasady rozwoju postaci (D&D 2024)</a></p>
    </> : <p>GM odblokuje kolejny poziom po osiągnięciu kamienia milowego przygody.{data.character.level >= 20 && ' Osiągnięto maksymalny poziom 20.'}</p>}
    <h3>Historia rozwoju</h3><AdvancementHistory entries={data.history} />
  </section>;
}
