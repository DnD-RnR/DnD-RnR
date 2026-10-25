export const navigation = [
  { id: 'games', label: 'Gry', symbol: '⚄' },
  { id: 'characters', label: 'Postacie', symbol: '♙' },
] as const;

export type PageId = (typeof navigation)[number]['id'] | 'admin' | 'create-character' | 'game';
