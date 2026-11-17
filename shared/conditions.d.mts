import type { TimedEffect } from './timed-effects.mjs';
export type ConditionSource = { id: string; kind: string; sourceId: string; sourceCharacterId?: number; sourceName?: string; visible?: boolean; escapeDC?: number };
export type ConditionSubject = { zoneConditions?: { kind: string; zoneId: string }[]; id?: string; exhaustion?: number; seenInvisibleIds?: string[]; conditionSources?: ConditionSource[]; hp?: number; relentlessRagePending?: { dc: number } | null; visibleConditions?: string[]; manualConditions?: string[]; spellConditions?: { kind: string }[]; timedEffects?: TimedEffect[]; incapacitated?: boolean; unconscious?: boolean; prone?: boolean };
export const conditionDefinitions: Record<string, { label: string; description: string }>;
export function conditionsOf(fighter?: ConditionSubject): Set<string>;
export function hasCondition(fighter: ConditionSubject | undefined, kind: string): boolean;
export function isIncapacitated(fighter: ConditionSubject): boolean;
export function conditionSpeedZero(fighter: ConditionSubject): boolean;
export function automaticSaveFailure(fighter: ConditionSubject, ability: string): boolean;
export function conditionSaveDisadvantage(fighter: ConditionSubject, ability: string): boolean;
export function automaticCheckFailure(fighter: ConditionSubject, context?: { requiresSight?: boolean; requiresHearing?: boolean }): boolean;
export function conditionCheckDisadvantage(fighter: ConditionSubject, ability?: string): boolean;
export function conditionAttackModifiers(attacker?: ConditionSubject, target?: ConditionSubject, context?: { within5Feet?: boolean }): { advantage: boolean; disadvantage: boolean; criticalOnHit: boolean };

export function exhaustionPenalty(fighter?: ConditionSubject): number;
export function conditionSourcesOf(fighter: ConditionSubject | undefined, kind: string): Array<{ kind: string; sourceId: string; visible?: boolean }>;
export function cannotHarm(actor?: ConditionSubject, target?: ConditionSubject): boolean;
export function socialAdvantage(actor?: ConditionSubject, target?: ConditionSubject): boolean;
export function invisibleBenefits(fighter?: ConditionSubject): boolean;
export function canSeeConditionTarget(viewer?: ConditionSubject, target?: ConditionSubject): boolean;

export function conditionSaveAdvantage(fighter: ConditionSubject | undefined, ability?: string): boolean;

export function conditionCheckAdvantage(fighter: ConditionSubject, ability?: string): boolean;
