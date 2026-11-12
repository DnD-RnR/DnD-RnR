import { useEffect, useState } from 'react';
import { api } from '../../api';
import type { SpellcastingState } from '../games/battle-types';

export function SpellResources({ characterId }: { characterId: number }) {
  const [state, setState] = useState<SpellcastingState | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try { const data = await api<{ spellcasting: SpellcastingState }>(`/characters/${characterId}/spell-resources`); if (alive) { setState(data.spellcasting); setError(''); } }
      catch (e) { if (alive) setError(e instanceof Error ? e.message : 'Błąd odczytu miejsc na czary.'); }
    };
    void load(); const timer = window.setInterval(() => void load(), 10000); window.addEventListener('focus', load);
    return () => { alive = false; window.clearInterval(timer); window.removeEventListener('focus', load); };
  }, [characterId]);
  if (error) return <p role="alert" className="form-error">{error}</p>;
  if (!state || (!state.slots.length && !state.species?.heroicInspirationAvailable && !state.barbarian?.max)) return null;
  return <section aria-label="Miejsca na czary i zasoby gatunku"><h3>Pozostałe miejsca na czary i zasoby</h3><dl className="gm-vitals">{Boolean(state.barbarian?.max) && <><div><dt>Szał — pozostałe użycia</dt><dd>{state.barbarian!.uses}/{state.barbarian!.max}</dd></div><div><dt>Premia obrażeń w Szale (Siła)</dt><dd>+{state.barbarian!.damage}</dd></div>{state.barbarian!.relentless && <div><dt>Relentless Rage — ST</dt><dd>{state.barbarian!.relentlessDC}</dd></div>}{state.barbarian!.persistent && <div><dt>Persistent Rage — odzyskanie przy inicjatywie</dt><dd>{state.barbarian!.recoveryAvailable ? 'Dostępne' : 'Po długim odpoczynku'}</dd></div>}</>}{state.slots.map(s => <div key={`${s.source}-${s.level}`}><dt>{s.level}. krąg{s.source === 'pact' ? ' · Pact Magic' : ''}</dt><dd>{s.remaining}/{s.total}</dd></div>)}{state.species?.heroicInspirationAvailable && <div><dt>Heroic Inspiration</dt><dd>Dostępna</dd></div>}</dl><p>Szał odzyskuje 1 użycie po krótkim i wszystkie po długim odpoczynku. Sztuczki nie zużywają miejsc. Zasoby są przypisane do postaci i pozostają zużyte po zakończeniu walki.</p></section>;
}
