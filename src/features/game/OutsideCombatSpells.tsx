import { useState } from 'react';
import { api } from '../../api';
import type { SpellcastingState } from '../games/battle-types';

export function OutsideCombatSpells({ characterId, state, onChange }: { characterId: number; state: SpellcastingState; onChange: (state: SpellcastingState) => void }) {
  const [effectChoice, setEffectChoice] = useState('');
  const [id, setId] = useState(''), [resource, setResource] = useState('');
  const [confirmed, setConfirmed] = useState(false), [pending, setPending] = useState(false);
  const [error, setError] = useState(''), [message, setMessage] = useState('');
  const spell = state.spells.find(s => s.id === id);
  const options = spell ? [
    ...(/or Ritual/i.test(spell.castingTime ?? '') || spell.ritualOnly ? [{ key: `ritual:${spell.level}`, label: 'Rytuał — dodatkowe 10 minut, bez slotu' }] : []),
    ...(!spell.ritualOnly && spell.level === 0 ? [{ key: 'cantrip:0', label: 'Sztuczka' }] : []),
    ...(spell.legacyFreeCast ? [{ key: `legacy:${spell.level}`, label: 'Czary gatunku — bez slotu' }] : []),
    ...(spell.originFreeCast ? [{ key: `origin:${spell.level}`, label: 'Atut Origin — bez slotu' }] : []),
    ...(spell.arcanumRemaining ? [{ key: `arcanum:${spell.level}`, label: 'Mystic Arcanum' }] : []),
    ...(!spell.ritualOnly && spell.level > 0 ? state.slots.filter(s => s.remaining > 0 && s.level >= spell.level).map(s => ({ key: `${s.source}:${s.level}`, label: `${s.level}. krąg (${s.remaining}/${s.total})${s.source === 'pact' ? ' — Pact Magic' : ''}` })) : []),
  ] : [];
  const selected = options.some(o => o.key === resource) ? resource : options[0]?.key ?? '';
  return <details><summary>Rzuć czar poza walką / wykonaj rytuał</summary><form className="stack-form" onSubmit={async e => {
    e.preventDefault(); if (pending || !spell || !selected) return;
    setPending(true); setError(''); setMessage('');
    const [source, level] = selected.split(':');
    try {
      const data = await api<{ spellcasting: SpellcastingState; cast: { resolution: string } }>(`/characters/${characterId}/spell-resources`, { kind: 'cast-outside-combat', version: state.resourceVersion, spellId: id, source, level: Number(level), confirmed, effectChoice: effectChoice || spell.effect?.effectOptions?.[0] });
      onChange(data.spellcasting); setMessage(`${spell.name}: zapisano rzucenie. ${data.cast.resolution}`); setConfirmed(false);
    } catch (e) { setError(e instanceof Error ? e.message : 'Nie udało się rzucić czaru.'); }
    finally { setPending(false); }
  }}>
    <label>Czar<select required value={id} onChange={e => { setId(e.target.value); setEffectChoice(''); setResource(''); setConfirmed(false); }}><option value="">Wybierz czar</option>{state.spells.map(s => <option key={s.id} value={s.id}>{s.name} — {s.level}. krąg</option>)}</select></label>
    {spell && <><p>{spell.castingTime} · {spell.range} · {spell.duration}</p><p className="item-description">{spell.description}</p>{spell.upgrade && <p>{spell.upgrade}</p>}<label>Źródło<select required value={selected} onChange={e => setResource(e.target.value)}>{!options.length && <option value="">Brak dostępnego zasobu</option>}{options.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}</select></label><label><input required type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />Potwierdzam z MG pełny czas rzucania, komponenty i warunki czaru. Efekty poza walką rozstrzyga MG.</label><button disabled={pending || !selected}>Zapisz rzucenie czaru</button></>}
    {spell?.effect?.effectOptions && <label>Wariant efektu<select value={effectChoice || spell.effect.effectOptions[0]} onChange={e => setEffectChoice(e.target.value)}>{spell.effect.effectOptions.map(choice => <option key={choice} value={choice}>{choice}</option>)}</select></label>}
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
  </form></details>;
}
