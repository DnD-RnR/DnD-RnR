import type { Character } from '../../api';

export function CharacterGameInfo({ character }: { character: Character }) {
  return <p>Gra: <strong>{character.gameName ?? 'Nie należy jeszcze do żadnej gry'}</strong></p>;
}
