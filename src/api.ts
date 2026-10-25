export type User = { id: number; username: string; name: string; role: 'admin' | 'player' };
export type Character = { id: number; name: string; class: string; level: number };

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
