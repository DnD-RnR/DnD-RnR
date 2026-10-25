export const navigation = [
  { id: 'campaign', label: 'Kampania', symbol: '◈' },
  { id: 'characters', label: 'Postacie', symbol: '♙' },
  { id: 'sessions', label: 'Sesje', symbol: '▦' },
  { id: 'notes', label: 'Notatki', symbol: '✎' },
] as const;

export type PageId = (typeof navigation)[number]['id'] | 'admin';
