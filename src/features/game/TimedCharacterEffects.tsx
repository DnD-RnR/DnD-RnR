import { conditionDefinitions } from '../../../shared/conditions.mjs';
import { useState } from 'react';
import { api } from '../../api';
import type { SpellcastingState } from '../games/battle-types';

export function TimedCharacterEffects({ characterId, state, onChange }: { characterId: number; state: SpellcastingState; onChange: (value: SpellcastingState) => void }) {
  const [pending, setPending] = useState(false), [error, setError] = useState('');
  async function end(kind: string, castingId?: string) {
    setPending(true); setError('');
    try { const result = await api<{ spellcasting: SpellcastingState }>(`/characters/${characterId}/spell-resources`, { kind, castingId, version: state.resourceVersion }); onChange(result.spellcasting); }
    catch (e) { setError(e instanceof Error ? e.message : 'Nie udało się zakończyć efektu.'); }
    finally { setPending(false); }
  }
  if (!state.conditions?.length && !state.activeEffects?.length && !state.concentration) return null;
  return <section><h3>Aktywne czary i stany</h3>{state.conditions?.map(id => <p key={id}><strong>{conditionDefinitions[id]?.label ?? id}</strong>: {conditionDefinitions[id]?.description}</p>)}{state.concentration && <p>Koncentracja: {state.concentration} <button className="text-button" disabled={pending} onClick={() => void end('end-concentration')}>Zakończ — bez akcji</button></p>}
    {(!!state.conditions?.length || !!state.activeEffects?.length) && state.effectiveStats && <p>Po uwzględnieniu efektów: KP {state.effectiveStats.ac ?? '—'} · szybkość {state.effectiveStats.speed ?? '—'} stóp · PW {state.effectiveStats.hp ?? '—'}/{state.effectiveStats.maxHp ?? '—'}.</p>}
    {state.activeEffects?.map(e => <p key={e.id}>{e.name} · {e.remainingSeconds == null ? 'do zakończenia efektu' : `pozostało ${Math.ceil(e.remainingSeconds / 60)} minut czasu gry`}{e.dismissible !== false && e.sourceCharacterId === characterId && <button className="text-button" disabled={pending} onClick={() => void end('dismiss-effect', e.castingId)}>Zakończ czar</button>}</p>)}
    <p>Czas efektów upływa w rundach walki oraz gdy MG przesuwa czas gry lub zatwierdza odpoczynek.</p>{error && <p role="alert">{error}</p>}
  </section>;
}
