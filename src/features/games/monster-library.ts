import { randomId } from '../../lib/id';
import { api } from '../../api';
import definitions from '../../../shared/statistics.json' with { type: 'json' };

export type Enemy = { id: string; name: string; hp: number; ac: number; speed: number; notes: string; saves: Record<string, number> };
export const monsterLibraryKey = (userId: number, gameId: number) => `dnd-enemies:${userId}:${gameId}`;
export const blankEnemy = (): Enemy => ({ id: randomId(), name: '', hp: 1, ac: 10, speed: 30, notes: '', saves: Object.fromEntries(definitions.abilities.map(a => [a.id, 0])) });
const pending = new Map<string, Promise<Enemy[]>>();
export function readMonsters(userId: number, gameId: number): Promise<Enemy[]> {
  const key = monsterLibraryKey(userId, gameId);
  const existing = pending.get(key);
  if (existing) return existing;
  const request = (async () => {
    let result = await api<{ monsters: Enemy[] }>(`/games/${gameId}/monsters`);
    // Retain the local backup; mark migration only after every server write succeeds.
    const marker = key + ':firebase-imported';
    let local: unknown = null;
    try { if (localStorage.getItem(marker) !== '1') local = JSON.parse(localStorage.getItem(key) || 'null'); }
    catch { throw new Error('Nie udało się odczytać lokalnej kopii potworów do importu.'); }
    if (Array.isArray(local)) {
      for (const monster of local) result = await api<{ monsters: Enemy[] }>(`/games/${gameId}/monsters/import`, { monster });
      try { localStorage.setItem(marker, '1'); } catch { /* A retry remains idempotent. */ }
    }
    return result.monsters;
  })();
  pending.set(key, request);
  void request.finally(() => pending.delete(key)).catch(() => {});
  return request;
}
export async function saveMonster(gameId: number, action: 'create' | 'update' | 'delete', monster: Enemy): Promise<Enemy[]> {
  const result = await api<{ monsters: Enemy[] }>(`/games/${gameId}/monsters/${action}`, action === 'delete' ? { id: monster.id } : { monster });
  return result.monsters;
}
