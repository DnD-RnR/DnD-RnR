import type { RageProfile } from '../../../shared/barbarian.mjs';
export type Attack = { ability?: string; finesse?: boolean; strengthBonus?: number; strengthDamageBonus?: number; id: string; name: string; bonus: number; dice: number; sides: number; damageBonus: number; type: string; light: boolean; offHand?: boolean; nick?: boolean; disadvantage?: boolean };
export type Combatant = {
  warlockBond?: { targetId?: string; targetName: string; expiresAt: number; combat?: boolean } | null; thoughtShield?: boolean; warlockResistance?: string | null;
  hex?: { targetId: string; ability: string; eldritch: boolean; expiresAt: number; name: string };
  psiMax?: number; psiUses?: number; psiSides?: number; psiInt?: number | null; psiStrikeUsed?: boolean; telekineticMovementAvailable?: boolean;
  attackRollMade?: boolean; recklessActive?: boolean;
  rageProfile?: RageProfile; rageUses?: number; rage?: { expiresRound: number; maxRound: number } | null; rageRecoveryOffered?: boolean; relentlessRagePending?: { dc: number } | null; incapacitated?: boolean; unconscious?: boolean;
  spellcasting?: SpellcastingState; concentration?: string | null; concentrationDC?: number | null; concentrationChecks?: number[]; reactionDeferred?: boolean;
  mockery?: { expiresRound: number } | null; protectionAvailable?: boolean; protectedBy?: string[];
  hidden?: boolean; damageTaken?: number; attackDisadvantage?: boolean;
  id: string; name: string; memberId?: number; characterId?: number; ownerId?: number;
  initiative: number; level?: number; hp: number; maxHp: number; tempHp: number; ac: number | null; speed: number;
  secondWindUses?: number; secondWindMax?: number; adrenalineRushUses?: number; adrenalineRushMax?: number; relentlessEnduranceAvailable?: boolean;
  breathWeaponUses?: number; breathWeaponMax?: number; breathWeaponDamage?: number; breathWeaponType?: string | null; breathWeaponDC?: number | null;
  goliathAncestry?: { id: string; label: string } | null; giantAncestry?: { id: string; label: string } | null; giantAncestryUses?: number; giantAncestryMax?: number; largeFormAvailable?: boolean;
  draconicFlightAvailable?: boolean; flying?: boolean; flySpeed?: number; damageResistance?: string | null;
  saves: Record<string, number | null>; notes: string; attacks: Attack[]; maxAttacks: number;
  action: string; bonus: string; reaction: string; moved: number; pounceMoved?: number; extraMove: number;
  attacksLeft: number; usedWeapons: string[]; dodge: boolean; deathSuccesses: number; deathFailures: number;
};
export type Combat = {
  fiendDefeats?: Array<{ id: string; targetName: string; sourceId?: string; candidates: string[]; granted: string[] }>;
  slotCasters?: string[];
  startedAt?: number;
  defeatedMonsters?: Array<{ id: string; name: string; damageTaken?: number }>;
  summary?: { endedAt: number; rounds: number; defeatedMonsterCount: number; remainingMonsterCount: number };
  version: number; sessionId: number; active: boolean; round: number; turn: number;
  fighters: Combatant[]; log: string[];
  pending: null | SpellPending | { kind: 'waiting'; actorId: string } | { kind: 'damage'; actorId: string; targetId: string; attack: Attack; critical: boolean }
    | { kind: 'request'; actorId: string; slot: 'action' | 'bonus' | 'reaction'; description: string; roll?: number; breathWeapon?: boolean; warlockBond?: boolean; targetId?: string; dc?: number };
};
export type CombatResponse = { battle: Combat | null; gm: boolean; controlledIds: string[] };
export type SpellEffect = { mode: 'attack' | 'save' | 'heal' | 'shield'; dice: number; sides: number; area?: boolean; bonus?: number; ability?: boolean; cantrip?: boolean; perLevel?: number; half?: boolean; save?: string; type?: string };
export type SpellChoice = { id: string; name: string; level: number; action: 'action' | 'bonus' | 'reaction' | null; effect: SpellEffect | null; arcanum: boolean; arcanumRemaining: boolean; originFreeCast?: boolean; description?: string; upgrade?: string; range?: string; duration?: string; url: string };
export type SpellcastingState = { warlock?: import('../../../shared/warlock.mjs').WarlockProfile; psiWarrior?: import('../../../shared/psi-warrior.mjs').PsiResources; barbarian?: RageProfile & { uses: number; relentlessDC: number; recoveryAvailable: boolean }; slots: Array<{ level: number; total: number; remaining: number; source: string }>; spells: SpellChoice[]; ability: number | null; attack: number | null; dc: number | null; error: string | null; resourceVersion: number; species?: { heroicInspirationAvailable?: boolean } };
export type SpellPending = { hexDice?: number; kind: 'spell'; actorId: string; spellName: string; stage: 'attack' | 'save' | 'effect'; spec: SpellEffect; targets: Array<{ id: string; saved?: boolean; defenseReady?: boolean; multiplier?: number }>; critical?: boolean; dc: number; attackBonus: number };
