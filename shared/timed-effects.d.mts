export type TimedEffect = { id: string; castingId: string; dismissible?: boolean; spellId: string; name: string; sourceCharacterId: number; sourceFighterId: string; sourceName?: string; sourceInitiative: number; concentrationKey: string | null; level: number; potency: number; dc?: number; lastSaveRound?: number; modifiers: { condition?: string | null; speedZero?: boolean; repeatSave?: string | null; hpBonus?: number; acBonus?: number; minimumAc?: number; mageArmor?: boolean; speedBonus?: number; resistances?: string[] }; createdAt: number; expiresAt: number | null; remainingSeconds?: number | null; sessionId: number | null; battleStartedAt: number | null; endRound: number | null; endPhase?: string };
export const timedSpellDefinitions: Record<string, { seconds: number | null; concentration?: boolean; hostile?: boolean; targets: number; targetsPerLevel?: number; save?: string; conditionOptions?: string[] }>;
export function strongestEffects(effects?: TimedEffect[]): TimedEffect[];
export function timedHpBonus(effects?: TimedEffect[]): number;
export function timedAc(fighter: { ac: number | null; timedEffects?: TimedEffect[]; wearingArmor?: boolean; dexModifier?: number | null; equipmentShieldBonus?: number; shieldAC?: number }): number | null;
export function timedSpeedBonus(fighter: { timedEffects?: TimedEffect[] }): number;
export function timedResistance(fighter: { timedEffects?: TimedEffect[] }, type: string): boolean;
export function timedRollModifier(fighter: { timedEffects?: TimedEffect[] }, body: { blessRoll?: number; baneRoll?: number }): number;
