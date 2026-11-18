import { useState } from 'react';
import { api } from '../../api';
import type { SpellcastingState } from '../games/battle-types';

export function SpeciesResources({ characterId, state, onChange }: { characterId: number; state: SpellcastingState; onChange: (state: SpellcastingState) => void }) {
  const [ability, setAbility] = useState('');
  const [rolls, setRolls] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [description, setDescription] = useState('');
  const [deviceEffect, setDeviceEffect] = useState('light');
  const [form, setForm] = useState('wings');
  const [effect, setEffect] = useState('flight');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const species = state.species;
  if (!species?.name) return null;
  const options: [string, string][] = [];
  if (species.maxAdrenalineRush) options.push(['species-adrenaline', `Adrenaline Rush (${species.adrenalineRushUses}/${species.maxAdrenalineRush})`]);
  if (species.healingHandsAvailable) options.push(['species-healing-hands', 'Healing Hands — ulecz siebie']);
  if (species.revelationAvailable) options.push(['species-revelation', 'Celestial Revelation']);
  if (species.stonecunningRemaining) options.push(['species-stonecunning', `Stonecunning (${species.stonecunningRemaining} użyć)`]);
  if (species.largeFormAvailable) options.push(['species-large', 'Large Form']);
  if (species.draconicFlightAvailable) options.push(['species-flight', 'Draconic Flight']);
  if (species.heroicInspirationAvailable) options.push(['species-inspiration', 'Heroic Inspiration — zużyj inspirację']);
  if (species.rockGnome) options.push(['gnome-device', 'Utwórz urządzenie — 10 minut']);
  if (Object.keys(species.effects ?? {}).length) options.push(['species-end', 'Zakończ przemianę / lot']);
  const selected = options.some(([id]) => id === ability) ? ability : options[0]?.[0];
  const submit = async (extra: Record<string, unknown> = {}) => {
    setBusy(true); setError('');
    try {
      const result = await api<{ spellcasting: SpellcastingState }>(`/characters/${characterId}/spell-resources`, { method: 'POST', body: JSON.stringify({ kind: 'species-outside', ability: selected, version: state.resourceVersion, confirmed, rolls: rolls.split(/[ ,;]+/).filter(Boolean).map(Number), roll: Number(rolls), form, effect, description, deviceEffect, ...extra }) });
      onChange(result.spellcasting);
    } catch (e) { setError(e instanceof Error ? e.message : 'Nie udało się użyć zdolności.'); } finally { setBusy(false); }
  };
  return <details><summary>Zasoby gatunku — {species.name}</summary>
    {Object.entries(species.effects ?? {}).map(([key, value]) => <p key={key}>{key}: do {new Date(value.expiresAt).toLocaleTimeString('pl-PL')}</p>)}
    {!!species.gnomeDevices?.length && <ul>{species.gnomeDevices.map(device => <li key={device.id}>{device.description} — KP 5, PW 1; aktywacja dotykiem jako akcja dodatkowa. <button disabled={busy} onClick={() => void submit({ ability: 'gnome-dismantle', deviceId: device.id, confirmed: true })}>Rozmontuj dotykiem (Utilize)</button></li>)}</ul>}
    {selected && <form className="stack-form" onSubmit={e => { e.preventDefault(); void submit(); }}>
      <label>Zdolność<select value={selected} onChange={e => setAbility(e.target.value)}>{options.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      {selected === 'species-healing-hands' && <label>Wyniki k4, oddzielone spacjami<input required value={rolls} onChange={e => setRolls(e.target.value)} /></label>}
      {selected === 'species-inspiration' && <label>Nowy wynik k20 (użyj go w rozstrzyganym teście)<input required type="number" min={1} max={20} value={rolls} onChange={e => setRolls(e.target.value)} /></label>}
      {selected === 'species-revelation' && <label>Przemiana<select value={form} onChange={e => setForm(e.target.value)}><option value="wings">Heavenly Wings</option><option value="radiance">Inner Radiance — obrażenia rozlicz w walce</option></select></label>}
      {selected === 'species-end' && <label>Efekt<select value={effect} onChange={e => setEffect(e.target.value)}><option value="flight">Draconic Flight</option><option value="large">Large Form</option><option value="revelation">Celestial Revelation</option></select></label>}
      {selected === 'gnome-device' && <><label>Pojedynczy efekt Prestidigitation<select value={deviceEffect} onChange={e => setDeviceEffect(e.target.value)}>{['sensory', 'light', 'ignite', 'extinguish', 'clean', 'soil', 'chill', 'warm', 'flavor', 'mark', 'trinket'].map(id => <option key={id}>{id}</option>)}</select></label><label>Ustalone działanie<input required maxLength={300} value={description} onChange={e => setDescription(e.target.value)} /></label></>}
      <label><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />Potwierdzono z MG czas, zasięg i warunki zdolności.</label>
      <button disabled={busy}>Użyj poza walką</button>
    </form>}
    {error && <p role="alert">{error}</p>}
  </details>;
}
