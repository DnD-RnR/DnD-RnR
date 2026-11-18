export type EpicBoon = import('./origin-feats.mjs').OriginFeat & { abilityIncrease: number; abilities: string[] };
export const epicBoons: EpicBoon[];
export function epicBoonForName(name?: string): EpicBoon | undefined;
