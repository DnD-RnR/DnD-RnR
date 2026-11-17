export type TimedEffect = { id: string; castingId: string; dismissible?: boolean; spellId: string; name: string; sourceCharacterId: number; sourceFighterId: string; sourceName?: string; sourceInitiative: number; concentrationKey: string | null; level: number; potency: number; dc?: number; lastSaveRound?: number; modifiers: { darkvision?: number; spiderClimb?: boolean; energyProtection?: boolean; deathWard?: boolean; fallProtection?: boolean; condition?: string | null; speedZero?: boolean; repeatSave?: string | null; hpBonus?: number; acBonus?: number; minimumAc?: number; mageArmor?: boolean; armorOfAgathys?: boolean; fireShield?: boolean; retaliationAmount?: number; retaliationType?: string; sizeDelta?: number; strAdvantage?: boolean; strDisadvantage?: boolean; flySpeed?: number; hover?: boolean; speedBonus?: number; speedMultiplier?: number; haste?: boolean; slow?: boolean; dexAdvantage?: boolean; resistances?: string[] }; createdAt: number; expiresAt: number | null; remainingSeconds?: number | null; sessionId: number | null; battleStartedAt: number | null; endRound: number | null; endPhase?: string };
export const timedSpellDefinitions: Record<string, { willingOnly?: boolean; self?: boolean; ward?: boolean; optionalSave?: boolean; effectOptions?: string[]; sizeChange?: boolean; requiresSight?: boolean; seconds: number | null; concentration?: boolean; hostile?: boolean; targets: number; targetsPerLevel?: number; save?: string; conditionOptions?: string[] }>;
export function strongestEffects(effects?: TimedEffect[]): TimedEffect[];
export function timedHpBonus(effects?: TimedEffect[]): number;
export function timedAc(fighter: { ac: number | null; timedEffects?: TimedEffect[]; wearingArmor?: boolean; dexModifier?: number | null; equipmentShieldBonus?: number; shieldAC?: number }): number | null;
export function timedSpeedBonus(fighter: { timedEffects?: TimedEffect[] }): number;
export function timedResistance(fighter: { timedEffects?: TimedEffect[] }, type: string): boolean;
export function timedRollModifier(fighter: { timedEffects?: TimedEffect[] }, body: { blessRoll?: number; baneRoll?: number }): number;

export function timedSpeedMultiplier(fighter: { timedEffects?: TimedEffect[] }): number;
export function hasTimedModifier(fighter: { timedEffects?: TimedEffect[] } | undefined, key: string): boolean;
export function timedSaveModifier(fighter: { timedEffects?: TimedEffect[] }, ability?: string): number;

export function timedFlySpeed(fighter: { flySpeed?: number; timedEffects?: TimedEffect[] }): number;
export function weaponSizeModifier(fighter?: { timedEffects?: TimedEffect[] }): number;
export function timedSize(fighter: { size?: string | null; timedEffects?: TimedEffect[] }): string | null;

export function timedDarkvision(fighter: { darkvision?: number | null; timedEffects?: TimedEffect[] }): number;
