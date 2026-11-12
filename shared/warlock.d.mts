export function fiendProfile(character: { class?: string; subclass?: string; level: number }, charisma: number | null | undefined): { enabled: boolean; temporaryHitPoints: number | null; nearbyFeet: number };

export type WarlockProfile = { enabled: boolean; level: number; fiend: ReturnType<typeof fiendProfile>; greatOldOne: boolean; cunningAvailable: boolean; contactPatronAvailable: boolean; luckMax: number; luckRemaining: number; resilience: boolean; resistance: string | null; resilienceChoiceAvailable: boolean; telepathyMiles: number | null; telepathyMinutes: number; awakenedMind: { targetId?: string; targetName: string; expiresAt: number; combat?: boolean } | null; clairvoyantCombatant: boolean; clairvoyantAvailable: boolean; eldritchHex: boolean; thoughtShield: boolean };
export function warlockProfile(character: { class?: string; subclass?: string; level: number }, charisma: number | null | undefined, state?: Record<string, any>): WarlockProfile;
export const resilienceTypes: string[];
export const warlockDescriptions: Record<string, string>;
export function bondAdvantage(actor: any, target: any): boolean;
export function hexDisadvantage(b: any, target: any, ability: string, saving?: boolean): boolean;
export function warlockResistance(f: any, type: string): boolean;

export function damageTypeName(type: string): string;
export function hexActive(actor: any, target: any): boolean;
