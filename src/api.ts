export type User = { id: number; username: string; name: string; role: 'admin' | 'player' | 'gm' };
export type Character = { id: number; name: string; class: string; level: number; species: string; background: string; subclass: string; gameName?: string | null; activeSessionId?: number | null; participating?: number; weaponMastery?: string[] };
export type CharacterSession = { game: { id: number; name: string } | null; activeSession: { id: number; startedAt: number; participating: boolean } | null };
export type InventoryItem = { id: number; name: string; description: string; quantity: number; slot: string; equipped: number; weight?: number | null; cost?: string; grip: 'one' | 'two' | 'none'; weapon?: Weapon | null; armor?: { id: string; category: 'light' | 'medium' | 'heavy' | 'shield' } | null };
export type CatalogItem = { id: number; name: string; description: string; slot: string; weight?: number | null; cost?: string; armorId?: string | null; armorCategory?: 'light' | 'medium' | 'heavy' | 'shield' | null };
export type Weapon = {
  id: string; name: string; category: 'simple' | 'martial'; type: 'wręczna' | 'dystansowa';
  damage: string; damageType: string; range: string; weight: number | null; cost: string;
  properties: string[]; mastery: string;
};
export type StatisticsSummary = {
  hp: number | null; maxHp: number | null; tempHp: number | null; ac: number | null;
  speed: number | null; proficiency: number; initiative: number | null; passivePerception: number | null;
  stealthDisadvantage?: boolean;
  untrainedArmor?: boolean; untrainedShield?: boolean; d20StrengthDexDisadvantage?: boolean; spellcastingBlocked?: boolean;
  deathSuccesses: number | null; deathFailures: number | null; exhaustion: number | null; inspiration: number | null;
  spellAttack: number | null; spellDc: number | null;
  abilities: Record<string, { score: number | null; modifier: number | null }>;
  savingThrows: Record<string, number | null>; skills: Record<string, number | null>;
};
export type CharacterStatistics = {
  armorClassBase?: 'standard' | 'class';
  proficiency: number;
  traits: import('../shared/character-traits.mjs').TraitSelection;
  spells: import('../shared/spellcasting.mjs').SpellSelection;
  values: Record<string, number | null>;
  savingThrows: string[];
  skills: Record<string, number>;
  spellAbility: string;
  stealthDisadvantage?: boolean;
  untrainedArmor?: boolean; untrainedShield?: boolean; d20StrengthDexDisadvantage?: boolean; spellcastingBlocked?: boolean;
  notes: Record<string, string>;
  choices: { weaponMastery: string[]; fightingStyle: string; arcaneWarrior?: { cantrips: string[]; ability: string }; fastCrafting?: string };
  fastCraftingOptions?: { value: string; name: string; toolLabel: string }[];
  hasCrafter?: boolean;
};

export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && path !== '/login' && path !== '/me') window.dispatchEvent(new Event('session-expired'));
    throw new Error(data.error || 'Nie udało się wykonać operacji.');
  }
  return data;
}
