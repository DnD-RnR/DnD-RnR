/** Polish dice notation for displayed rules and descriptions: 2d6 + 2 → 2k6+2. */
export function formatDice(text: string): string {
  return text.replace(/(?<![\p{L}\p{N}_])(?:(\d+)\s*(?:[×x]\s*)?)?[dDkK](100|20|12|10|8|6|4)(?![\p{L}\p{N}_])((?:\s*[+−-]\s*\d+)*)/gu,
    (_, count: string | undefined, sides: string, modifiers: string) => `${count ?? ''}k${sides}${modifiers.replace(/\s/g, '').replaceAll('−', '-')}`);
}
