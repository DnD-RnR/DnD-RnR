import { conditionDefinitions, conditionsOf, conditionSpeedZero, hasCondition } from '../../../shared/conditions.mjs';
import type { Combatant } from './battle-types';
import type { useBattle } from './LiveBattle';

export function ConditionControls({ actor, controller }: { actor: Combatant; controller: ReturnType<typeof useBattle> }) {
  const b = controller.response!.battle!, active = conditionsOf(actor);
  const ownTurn = actor.id === b.fighters[b.turn].id && controller.response!.controlledIds.includes(actor.id);
  return <>
    {!!active.size && <details open><summary>Stany postaci</summary>{[...active].map(id => <p key={id}><strong>{conditionDefinitions[id]?.label ?? id}</strong>: {conditionDefinitions[id]?.description}</p>)}</details>}
    {ownTurn && hasCondition(actor, 'prone') && <button disabled={controller.pending || Boolean(b.pending) || conditionSpeedZero(actor) || actor.speed === 0} onClick={() => void controller.mutate('act', { kind: 'stand-up' })}>Wstań — koszt połowy szybkości</button>}
    {controller.response!.gm && <details><summary>MG: ręczne źródła stanów</summary><p>Usunięcie ręcznego źródła nie usuwa stanu z aktywnego czaru. Nakładanie i usuwanie stanów nie zużywa akcji postaci.</p>{Object.entries(conditionDefinitions).map(([id, definition]) => <label className="battle-check" key={id}><input type="checkbox" checked={(actor.manualConditions ?? []).includes(id) || id === 'incapacitated' && actor.incapacitated === true || id === 'unconscious' && actor.unconscious === true || id === 'prone' && actor.prone === true} disabled={controller.pending || Boolean(b.pending)} onChange={e => void controller.mutate('act', { kind: 'condition', actorId: actor.id, condition: id, enabled: e.target.checked })} />{definition.label}</label>)}</details>}
  </>;
}
