import type { Combatant } from './battle-types';
export function LuckInput({ actor, value, onChange }: { actor: Combatant; value: string; onChange: (s: string) => void }) {
  const p = actor.spellcasting?.warlock;
  if (!p?.luckRemaining) return null;
  return <label>Dark One’s Own Luck — opcjonalny k10 po zobaczeniu k20, przed skutkami ({p.luckRemaining}/{p.luckMax})<input type="number" min={1} max={10} value={value} onChange={e => onChange(e.target.value)} /></label>;
}
