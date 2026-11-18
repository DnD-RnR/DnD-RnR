import { CheckForm } from './BarbarianControls';
import { useState } from 'react';
import type { Combatant } from './battle-types';
import type { useBattle } from './LiveBattle';

type Controller = ReturnType<typeof useBattle>;
export function SpeciesControls({ controller }: { controller: Controller }) {
  const { response } = controller;
  const [actorId, setActorId] = useState('');
  if (!response?.battle?.active) return null;
  const actors = response.battle.fighters.filter(f => f.species && (response.controlledIds.includes(f.id) || response.gm && (f.speciesEffects?.revelation?.form === 'radiance' || f.conditionSources?.some(e => e.kind === 'invisible') || response.battle!.pending?.kind === 'request' && response.battle!.pending.actorId === f.id)));
  const actor = actors.find(f => f.id === actorId) ?? actors[0];
  if (!actor) return null;
  return <details className="combat-reactions"><summary>Zdolności gatunku</summary>
    <label>Postać<select value={actor.id} onChange={e => setActorId(e.target.value)}>{actors.map(f => <option key={f.id} value={f.id}>{f.name} — {f.species}</option>)}</select></label>
    <SpeciesForm key={actor.id} actor={actor} controller={controller} /><CheckForm key={`check-${actor.id}`} f={actor} controller={controller} />
  </details>;
}
function SpeciesForm({ actor, controller }: { actor: Combatant; controller: Controller }) {
  const b = controller.response!.battle!;
  const [kind, setKind] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [targetId, setTargetId] = useState(actor.id);
  const [targetIds, setTargetIds] = useState<string[]>([]);
  const [roll, setRoll] = useState('');
  const [rolls, setRolls] = useState('');
  const [form, setForm] = useState('wings');
  const [effect, setEffect] = useState('flight');
  const options: [string, string][] = [];
  if (actor.conditionSources?.some(e => e.kind === 'invisible')) options.push(['species-hide-end', 'Hide: koniec ukrycia (znaleziono / hałas / opuszczenie osłony)']);
  if (controller.response!.gm && b.pending?.kind === 'request' && b.pending.actorId === actor.id && actor.breathWeaponMax) options.push(['species-breath-targets', 'Broń Oddechowa — MG wybiera cele obszaru']);
  if (actor.species === 'Aasimar') {
    options.push(['species-healing-hands', 'Healing Hands — akcja Magia']);
    if ((actor.level ?? 1) >= 3) options.push(['species-revelation', 'Celestial Revelation — akcja dodatkowa'], ['species-radiance-targets', 'Inner Radiance — cele na koniec tury (MG)']);
  }
  if (actor.species === 'Krasnolud (Dwarf)') options.push(['species-stonecunning', 'Stonecunning — akcja dodatkowa']);
  if (actor.species === 'Człowiek (Human)') options.push(['species-inspiration', 'Heroic Inspiration — zużyj inspirację']);
  if (actor.species === 'Niziołek (Halfling)') options.push(['species-hide', 'Naturally Stealthy — Hide']);
  if (actor.goliathAncestry?.id === 'cloud') options.push(['species-cloud', 'Cloud’s Jaunt — akcja dodatkowa']);
  if (actor.goliathAncestry?.id === 'stone') options.push(['species-stone', 'Stone’s Endurance — reakcja na oczekujące obrażenia']);
  if (actor.goliathAncestry?.id === 'storm') options.push(['species-storm', 'Storm’s Thunder — reakcja po otrzymaniu obrażeń']);
  if (actor.species === 'Goliat (Goliath)' && (actor.level ?? 1) >= 5) options.push(['species-large', 'Large Form — akcja dodatkowa']);
  if (Object.keys(actor.speciesEffects ?? {}).length) options.push(['species-end', 'Zakończ przemianę / lot — bez akcji']);
  if (!options.length) return <p>Pasywne cechy są dostępne na karcie postaci. Efekty przy trafieniu wybierz przy rozliczaniu obrażeń.</p>;
  const selected = options.some(([id]) => id === kind) ? kind : options[0][0];
  const multiple = selected === 'species-breath-targets' || selected === 'species-radiance-targets' || selected === 'species-revelation' && form === 'shroud';
  return <form className="stack-form" onSubmit={e => {
    e.preventDefault(); void controller.mutate('act', { kind: selected, actorId: actor.id, confirmed, targetId, targetIds, roll: Number(roll), total: Number(roll), rolls: rolls.split(/[ ,;]+/).filter(Boolean).map(Number), form, effect });
  }}>
    <label>Zdolność<select value={selected} onChange={e => setKind(e.target.value)}>{options.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
    {selected === 'species-revelation' && <label>Postać objawienia<select value={form} onChange={e => setForm(e.target.value)}><option value="wings">Heavenly Wings — lot</option><option value="radiance">Inner Radiance — blask 10 stóp</option><option value="shroud">Necrotic Shroud — strach, CHA</option></select></label>}
    {selected === 'species-healing-hands' && <><label>Cel w zasięgu dotyku<select value={targetId} onChange={e => setTargetId(e.target.value)}>{b.fighters.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label><label>Wyniki k4 (liczba kości równa premii biegłości)<input required value={rolls} onChange={e => setRolls(e.target.value)} placeholder="3 2" /></label></>}
    {['species-stone', 'species-storm', 'species-inspiration', 'species-hide'].includes(selected) && <label>{selected === 'species-hide' ? 'Wynik testu Stealth z premiami' : selected === 'species-stone' ? 'Wynik k12' : selected === 'species-storm' ? 'Wynik k8' : 'Nowy wynik k20 — użyj go w rozstrzyganym teście'}<input required type="number" value={roll} onChange={e => setRoll(e.target.value)} /></label>}
    {multiple && <fieldset><legend>{selected === 'species-radiance-targets' ? 'MG: wszystkie istoty w promieniu 10 stóp, łącznie z Aasimarem' : 'Wszystkie istoty inne niż sojusznicy w promieniu 10 stóp'}</legend>{b.fighters.map(f => <div key={f.id}><label><input type="checkbox" checked={targetIds.includes(f.id)} onChange={e => setTargetIds(previous => e.target.checked ? [...previous, f.id] : previous.filter(id => id !== f.id))} />{f.name}</label></div>)}</fieldset>}
    {selected === 'species-end' && <label>Efekt<select value={effect} onChange={e => setEffect(e.target.value)}><option value="flight">Draconic Flight</option><option value="large">Large Form</option><option value="revelation">Celestial Revelation</option></select></label>}
    <label><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />Potwierdzono z MG zasięg, widoczność i warunki zdolności (kontakt z kamieniem, miejsce na przemianę, osłona większej istoty).</label>
    {actor.speciesEffects && <p>Aktywne efekty: {Object.keys(actor.speciesEffects).join(', ') || 'brak'}.</p>}
    <button disabled={controller.pending}>Użyj zdolności</button>
  </form>;
}

export type SpeciesDamageChoice = { giantStrike?: boolean; giantRoll?: number; giantRolls?: number[]; revelationDamage?: boolean; speciesTargetId?: string };
export function SpeciesDamageInputs({ actor, value, onChange, critical = false }: { actor: Combatant; value: SpeciesDamageChoice; onChange: (value: SpeciesDamageChoice) => void; critical?: boolean }) {
  return <>
    {!!actor.giantAncestryUses && ['fire', 'frost', 'hill'].includes(actor.goliathAncestry?.id ?? '') && <><label><input type="checkbox" checked={!!value.giantStrike} onChange={e => onChange({ ...value, giantStrike: e.target.checked })} />{actor.goliathAncestry?.label} — użycia: {actor.giantAncestryUses}</label>{value.giantStrike && actor.goliathAncestry?.id !== 'hill' && Array.from({ length: critical ? 2 : 1 }, (_, i) => <label key={i}>Kość przodka {i + 1}<input required type="number" min={1} max={actor.goliathAncestry?.id === 'fire' ? 10 : 6} value={value.giantRolls?.[i] ?? ''} onChange={e => { const rolls = [...(value.giantRolls ?? [])]; rolls[i] = Number(e.target.value); onChange({ ...value, giantRolls: rolls }); }} /></label>)}</>}
    {actor.speciesEffects?.revelation && <label><input type="checkbox" checked={!!value.revelationDamage} onChange={e => onChange({ ...value, revelationDamage: e.target.checked })} />Celestial Revelation — dodatkowe obrażenia raz we własnej turze</label>}
  </>;
}
