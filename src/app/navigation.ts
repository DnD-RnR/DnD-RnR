export const navigation = [
  { id: 'characters', label: 'Postacie', symbol: '♙' },
] as const;

export type PageId = (typeof navigation)[number]['id'] | 'admin' | 'create-character';
