export type User = { id: number; username: string; name: string; role: 'admin' | 'player' | 'gm' };
export type Character = { id: number; name: string; class: string; level: number; species: string; background: string; subclass: string; gameName?: string | null };
export type InventoryItem = { id: number; name: string; description: string; quantity: number; slot: string; equipped: number };
export type CatalogItem = { id: number; name: string; description: string; slot: string };
export type CharacterStatistics = {
  traits: import('../shared/character-traits.mjs').TraitSelection;
  spells: import('../shared/spellcasting.mjs').SpellSelection;
  values: Record<string, number | null>;
  savingThrows: string[];
  skills: Record<string, number>;
  spellAbility: string;
  notes: Record<string, string>;
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
