import type { Combatant } from './battle-types';
import type { useBattle } from './LiveBattle';
import { strongestEffects } from '../../../shared/timed-effects.mjs';

export function TimedRollInputs({ actor, values, onChange }: { actor?: Combatant; values: Record<string, number>; onChange: (value: Record<string, number>) => void }) {
  return <>{(['bless', 'bane'] as const).filter(id => actor?.timedEffects?.some(e => e.spellId === id)).map(id => <label key={id}>{id === 'bless' ? 'Bless — dodaj k4' : 'Bane — odejmij k4'}<input required type="number" min={1} max={4} value={values[`${id}Roll`] ?? ''} onChange={e => onChange({ ...values, [`${id}Roll`]: e.target.valueAsNumber })} /></label>)}</>;
}

export function TimedEffectControls({ controller, actor }: { controller: ReturnType<typeof useBattle>; actor: Combatant }) {
  const b = controller.response!.battle!;
  const controlled = controller.response!.controlledIds;
  const activeIds = new Set(strongestEffects(actor.timedEffects).map(e => e.id));
  return <>{actor.concentration && controlled.includes(actor.id) && <button className="text-button" disabled={controller.pending} onClick={() => void controller.mutate('act', { kind: 'end-concentration', actorId: actor.id })}>Zakończ koncentrację — bez akcji</button>}
    {actor.timedEffects?.map(e => {
      const source = b.fighters.find(f => f.characterId === e.sourceCharacterId);
      return <p key={e.id}>{e.name} · {e.sourceName ?? source?.name ?? 'rzucający poza walką'} · {e.endRound == null ? 'do zakończenia efektu' : `${Math.max(0, Math.ceil(e.endRound - b.round))} rund`}{!activeIds.has(e.id) && ' · nie sumuje się z silniejszym lub nowszym rzuceniem'}{e.dismissible !== false && source && controlled.includes(source.id) && <button className="text-button" disabled={controller.pending} onClick={() => void controller.mutate('act', { kind: 'dismiss-effect', actorId: source.id, castingId: e.castingId })}>Zakończ czar</button>}</p>;
    })}
  </>;
}
