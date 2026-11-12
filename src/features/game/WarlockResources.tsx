import { useState } from 'react';
import { api } from '../../api';
import type { SpellcastingState } from '../games/battle-types';
import { resilienceTypes, warlockDescriptions } from '../../../shared/warlock.mjs';
export function WarlockResources({ characterId, state, onChange }: { characterId: number; state: SpellcastingState; onChange: (s: SpellcastingState) => void }) {
  const [pending, setPending] = useState(false), [error, setError] = useState('');
  const [damageType, setDamageType] = useState(''), [targetName, setTargetName] = useState(''), [confirmed, setConfirmed] = useState(false);
  const [luckRoll, setLuckRoll] = useState(''), [rollId, setRollId] = useState('');
  const p = state.warlock;
  if (!p?.enabled) return null;
  async function use(kind: string) {
    setPending(true); setError('');
    try { const data = await api<{ spellcasting: SpellcastingState }>(`/characters/${characterId}/spell-resources`, { method: 'POST', body: JSON.stringify({ kind, version: state.resourceVersion, damageType, targetName, confirmed, luckRoll: Number(luckRoll), rollId }) }); onChange(data.spellcasting); if (kind === 'dark-ones-own-luck') { setLuckRoll(''); setRollId(''); } }
    catch (e) { setError(e instanceof Error ? e.message : 'Błąd zdolności Warlocka.'); }
    finally { setPending(false); }
  }
  return <section className="card"><h3>Zdolności Warlocka</h3>{error && <p className="form-error" role="alert">{error}</p>}
    {p.level >= 2 && <><p>{warlockDescriptions['Magical Cunning']}</p><button disabled={pending || !p.cunningAvailable || !state.slots.some(s => s.source === 'pact' && s.remaining < s.total)} onClick={() => void use('magical-cunning')}>Magical Cunning — obrzęd 1 min</button></>}
    {p.level >= 9 && <><p>{warlockDescriptions['Contact Patron']}</p><label><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />Potwierdzam z GM czas rzucania i komponenty Contact Other Plane.</label><button disabled={pending || !confirmed || !p.contactPatronAvailable} onClick={() => void use('contact-patron')}>Contact Patron — bez miejsca, automatyczny sukces rzutu</button></>}
    {p.luckMax > 0 && <p>Dark One’s Own Luck: {p.luckRemaining}/{p.luckMax}. {warlockDescriptions["Dark One's Own Luck"]} Poza walką rzut rozlicza GM.</p>}
    {p.luckMax > 0 && <><label>Nazwa testu / rzutu (np. perswazja-1; raz na rzut)<input maxLength={80} pattern="[a-zA-Z0-9-]+" value={rollId} onChange={e => setRollId(e.target.value)} /></label><label>Dark One’s Own Luck — wynik k10<input type="number" min={1} max={10} value={luckRoll} onChange={e => setLuckRoll(e.target.value)} /></label><button disabled={pending || !p.luckRemaining || !rollId || !luckRoll} onClick={() => void use('dark-ones-own-luck')}>Dodaj k10 do testu / rzutu obronnego</button></>}
    {p.resilience && <><p>Fiendish Resilience: {p.resistance ?? 'nie wybrano'}</p><label>Odporność po odpoczynku<select value={damageType} onChange={e => setDamageType(e.target.value)}><option value="">Wybierz typ (poza Force)</option>{resilienceTypes.map(t => <option key={t} value={t}>{t}</option>)}</select></label><button disabled={pending || !damageType || !p.resilienceChoiceAvailable} onClick={() => void use('fiendish-resilience')}>Zapisz odporność</button></>}
    {p.greatOldOne && <><p>{warlockDescriptions['Awakened Mind']}</p><p>Zasięg więzi: {p.telepathyMiles ?? 'uzupełnij CHA'} mil · czas {p.telepathyMinutes} min. {p.awakenedMind ? `Cel: ${p.awakenedMind.targetName}` : 'Brak aktywnej więzi.'}</p><label>Imię celu<input maxLength={80} value={targetName} onChange={e => setTargetName(e.target.value)} /></label><label><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />GM potwierdza widoczność i odległość do 30 stóp.</label><button disabled={pending || !confirmed || !targetName.trim()} onClick={() => void use('awakened-mind')}>Awakened Mind — akcja dodatkowa</button><p>{warlockDescriptions['Psychic Spells']}</p></>}
    {p.clairvoyantCombatant && <><p>Clairvoyant Combatant: {p.clairvoyantAvailable ? 'dostępne' : 'zużyte'}. {warlockDescriptions['Clairvoyant Combatant']}</p><button disabled={pending || p.clairvoyantAvailable || !state.slots.some(s => s.source === 'pact' && s.remaining > 0)} onClick={() => void use('clairvoyant-recover')}>Odnów za miejsce Pact Magic</button></>}
    {p.eldritchHex && <p>{warlockDescriptions['Eldritch Hex']}</p>}{p.thoughtShield && <p>{warlockDescriptions['Thought Shield']}</p>}
  </section>;
}
