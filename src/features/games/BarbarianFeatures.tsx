import { useState } from 'react';
import type { useBattle } from './LiveBattle';
import type { Combatant } from './battle-types';
import { TimedRollInputs } from './TimedEffectControls';
import { HalflingLuck, halflingFields } from './HalflingLuck';

type Controller = ReturnType<typeof useBattle>;
export function BarbarianFeatures({ controller }: { controller: Controller }) {
  const b = controller.response!.battle!;
  return <>{b.fighters.filter(f => controller.response!.controlledIds.includes(f.id) && (f.rageProfile?.max || f.barbarianFears?.length || f.epicBoons?.length) || controller.response!.gm && (f.rage?.animal === 'wolf' || f.rage?.power === 'lion')).map(f => <FeatureForm key={f.id} actor={f} controller={controller} />)}</>;
}
function FeatureForm({ actor: f, controller }: { actor: Combatant; controller: Controller }) {
  const b = controller.response!.battle!, p = f.rageProfile;
  const [kind, setKind] = useState('');
  const [targetId, setTargetId] = useState(''), [targetIds, setTargetIds] = useState<string[]>([]);
  const [roll, setRoll] = useState(''), [roll2, setRoll2] = useState(''), [rolls, setRolls] = useState('');
  const [confirmed, setConfirmed] = useState(false), [restore, setRestore] = useState(false), [extended, setExtended] = useState(false), [hold, setHold] = useState(false);
  const [attackId, setAttackId] = useState(f.attacks.find(a => a.melee)?.id ?? '');
  const [effectId, setEffectId] = useState('');
  const [dc, setDc] = useState(''), [originalTotal, setOriginalTotal] = useState('');
  const [dim, setDim] = useState(true), [sign, setSign] = useState(1);
  const [advantage, setAdvantage] = useState(false), [disadvantage, setDisadvantage] = useState(false);
  const [timed, setTimed] = useState<Record<string, number>>({});
  const options: [string, string][] = [];
  const controlled = controller.response!.controlledIds.includes(f.id), level = f.level ?? 0;
  if (controlled) {
    if (f.epicBoons?.includes('Boon of Combat Prowess')) options.push(['epic-prowess', 'Peerless Aim: ostatnie pudło zamień w trafienie']);
    if (f.epicBoons?.includes('Boon of Dimensional Travel')) options.push(['epic-blink', 'Blink Steps: teleportacja po akcji']);
    if (f.epicBoons?.includes('Boon of Fate')) options.push(['epic-fate', 'Improve Fate: zmień ostatni test k20'], ['epic-fate-manual', 'Improve Fate: inny test rozstrzygany przez MG']);
    if (f.epicBoons?.includes('Boon of the Night Spirit')) options.push(['epic-light', 'MG: warunki oświetlenia'], ['epic-shadows', 'Merge with Shadows: Invisible']);
    if (p?.berserker && level >= 10) options.push(['retaliation', 'Retaliation — reakcja po otrzymaniu obrażeń']);
    if (p?.berserker && level >= 14) options.push(['barb-intimidating', 'Intimidating Presence — akcja dodatkowa']);
    if (p?.wildHeart && f.rage?.animal === 'eagle') options.push(['eagle-flight', 'Eagle — Dash i Disengage (akcja dodatkowa)']);
    if (p?.worldTree) {
      options.push(['barb-life-gift', 'Life-Giving Force — początek tury']);
      if (level >= 6) options.push(['barb-branches', 'Branches of the Tree — reakcja na początek tury']);
      if (level >= 14) options.push(['barb-travel', 'Travel along the Tree — teleportacja']);
    }
    if (p?.zealot) {
      if (level >= 6 && f.rage && !f.rage.fanaticalUsed) options.push(['barb-fanatical-check', 'Fanatical Focus: ostatni zwykły rzut obronny']);
      options.push(['barb-heal', `Warrior of the Gods — k12 leczenia (zużyto ${f.zealotDiceSpent ?? 0})`]);
      if (level >= 10) options.push(['barb-zealous', 'Zealous Presence — akcja dodatkowa']);
      if (level >= 14) options.push(['barb-revivification', 'Revivification — reakcja w boskiej formie']);
    }
    if (b.pending?.kind === 'spell' && b.pending.fanaticalTargetId === f.id) options.unshift(['barb-fanatical', 'Fanatical Focus — przerzut nieudanego rzutu']);
    if (f.barbarianFears?.length) options.unshift(['barb-fear-save', 'Intimidating Presence — powtórz WIS na koniec tury']);
  }
  if (controller.response!.gm && f.rage?.animal === 'wolf') options.push(['barb-wolf-targets', 'MG: wrogowie w zasięgu Wilka (5 stóp)']);
  if (controller.response!.gm && f.rage?.power === 'lion') options.push(['barb-lion-targets', 'MG: wrogowie w zasięgu Lwa (5 stóp)']);
  if (!options.length) return null;
  const selected = options.some(([id]) => id === kind) ? kind : options[0][0];
  return <details className="combat-reactions"><summary>{f.name} — cechy podklasy</summary><form className="stack-form" onSubmit={e => {
    e.preventDefault(); void controller.mutate('act', { kind: selected === 'retaliation' ? 'attack' : selected, actorId: f.id, slot: 'reaction', attackId, within5Feet: confirmed, targetId: selected === 'retaliation' ? f.barbarianDamageEvent?.sourceId : targetId, targetIds, ...halflingFields(e.currentTarget), ...timed, roll: Number(roll), roll2: Number(roll2), rolls: rolls.split(/[ ,;]+/).filter(Boolean).map(Number), originalTotal: Number(originalTotal), dc: Number(dc), effectId: effectId || f.barbarianFears?.[0]?.id, confirmed, restore, extended, hold, advantage, disadvantage, dim, sign });
  }}>
    <label>Zdolność<select value={selected} onChange={e => setKind(e.target.value)}>{options.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
    {selected === 'barb-life-gift' || selected === 'barb-revivification' ? <label>Cel<select required value={targetId} onChange={e => setTargetId(e.target.value)}><option value="">Wybierz...</option>{b.fighters.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label> : null}
    {['barb-intimidating', 'barb-zealous', 'barb-travel', 'barb-lion-targets', 'barb-wolf-targets'].includes(selected) && <fieldset><legend>Cele (zasięg, widoczność i zgodę pasażerów potwierdza MG)</legend>{b.fighters.filter(t => t.id !== f.id).map(t => <label key={t.id}><input type="checkbox" checked={targetIds.includes(t.id)} onChange={e => setTargetIds(previous => e.target.checked ? [...previous, t.id] : previous.filter(id => id !== t.id))} />{t.name}</label>)}</fieldset>}
    {['barb-life-gift', 'barb-heal', 'epic-fate', 'epic-fate-manual'].includes(selected) && <label>{selected.startsWith('epic-fate') ? 'Wyniki dwóch k4' : selected === 'barb-heal' ? 'Wyniki wydawanych k12' : 'Wyniki k6 (liczba = premia obrażeń Szału)'}<input required value={rolls} onChange={e => setRolls(e.target.value)} placeholder="3 4" /></label>}
    {selected === 'epic-fate-manual' && <label>Potwierdzony wynik pierwotnego testu (skutek po modyfikacji rozstrzyga MG)<input required type="number" value={originalTotal} onChange={e => setOriginalTotal(e.target.value)} /></label>}
    {selected.startsWith('epic-fate') && <label>Modyfikator<select value={sign} onChange={e => setSign(Number(e.target.value))}><option value={1}>Dodaj 2k4</option><option value={-1}>Odejmij 2k4</option></select></label>}
    {selected === 'epic-light' && <label><input type="checkbox" checked={dim} onChange={e => setDim(e.target.checked)} />Słabe światło lub ciemność</label>}
    {selected === 'retaliation' && <label>Broń wręcz<select value={attackId} onChange={e => setAttackId(e.target.value)}>{f.attacks.filter(a => a.melee || a.id === 'unarmed').map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>}
    {['retaliation', 'barb-fear-save', 'barb-fanatical', 'barb-fanatical-check'].includes(selected) && <><label>k20<input required type="number" min={1} max={20} value={roll} onChange={e => setRoll(e.target.value)} /></label><label>Druga k20, jeśli wymagana<input type="number" min={1} max={20} value={roll2} onChange={e => setRoll2(e.target.value)} /></label><HalflingLuck species={f.species} /><TimedRollInputs actor={f} values={timed} onChange={setTimed} /><label><input type="checkbox" checked={advantage} onChange={e => setAdvantage(e.target.checked)} />Ułatwienie</label><label><input type="checkbox" checked={disadvantage} onChange={e => setDisadvantage(e.target.checked)} />Utrudnienie</label></>}
    {selected === 'barb-fanatical-check' && <label>Potwierdzone przez MG ST nieudanego rzutu<input required type="number" min={1} max={100} value={dc} onChange={e => setDc(e.target.value)} /></label>}
    {selected === 'barb-fear-save' && <label>Źródło strachu<select value={effectId || f.barbarianFears?.[0]?.id} onChange={e => setEffectId(e.target.value)}>{f.barbarianFears?.map(e => <option key={e.id} value={e.id}>Intimidating Presence, ST {e.dc}</option>)}</select></label>}
    {selected === 'barb-fanatical' && <button type="button" disabled={controller.pending} onClick={() => void controller.mutate('act', { kind: 'barb-fanatical', actorId: f.id, decline: true })}>Przyjmij nieudany rzut bez przerzutu</button>}
    {['barb-intimidating', 'barb-zealous'].includes(selected) && <label><input type="checkbox" checked={restore} onChange={e => setRestore(e.target.checked)} />Jeśli zużyto zdolność: wydaj użycie Szału na jej odnowienie.</label>}
    {selected === 'barb-travel' && <label><input type="checkbox" checked={extended} onChange={e => setExtended(e.target.checked)} />150 stóp i do 6 pasażerów — raz na Szał (zwykła teleportacja: 60 stóp)</label>}
    {selected === 'barb-branches' && <label><input type="checkbox" checked={hold} onChange={e => setHold(e.target.checked)} />Po teleportacji szybkość celu 0 do końca bieżącej tury.</label>}
    <label><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />MG potwierdza zasięg, widoczność, moment wyzwolenia i wolne pole docelowe.</label>
    <button disabled={controller.pending}>Użyj zdolności</button>
  </form></details>;
}

export type BarbarianDamage = { frenzyRolls?: number[]; brutalRolls?: number[]; brutalEffects?: string[]; brutalFeet?: number; divineRolls?: number[]; divineType?: string; ram?: boolean; roots?: string; rootSave?: { roll?: number; roll2?: number }; confirmed?: boolean };
export function BarbarianDamageInputs({ actor, p, value, onChange }: { actor: Combatant; p: { critical: boolean; frenzyDice?: number; brutal?: boolean; divineFury?: boolean; attack: { roots?: boolean; melee?: boolean } }; value: BarbarianDamage; onChange: (value: BarbarianDamage) => void }) {
  const dice = (field: 'frenzyRolls' | 'brutalRolls' | 'divineRolls', count: number, sides: number, label: string) => <fieldset><legend>{label}</legend>{Array.from({ length: count }, (_, i) => <label key={i}>k{sides}<input required type="number" min={1} max={sides} value={value[field]?.[i] ?? ''} onChange={e => { const rolls = [...(value[field] ?? [])]; rolls[i] = Number(e.target.value); onChange({ ...value, [field]: rolls }); }} /></label>)}</fieldset>;
  const multiplier = p.critical ? 2 : 1;
  return <>
    {!!p.frenzyDice && dice('frenzyRolls', p.frenzyDice * multiplier, 6, 'Frenzy')}
    {p.brutal && <>{dice('brutalRolls', (actor.rageProfile?.brutalDice ?? 1) * multiplier, 10, 'Brutal Strike')}<fieldset><legend>Efekty Brutal Strike (maks. {actor.rageProfile?.brutalEffects})</legend>{['forceful', 'hamstring', ...((actor.level ?? 0) >= 13 ? ['staggering', 'sundering'] : [])].map(id => <label key={id}><input type="checkbox" checked={value.brutalEffects?.includes(id) ?? false} onChange={e => onChange({ ...value, brutalEffects: e.target.checked ? [...(value.brutalEffects ?? []), id] : value.brutalEffects?.filter(v => v !== id) })} />{id}</label>)}</fieldset>{value.brutalEffects?.includes('forceful') && <label>Ruch wprost do odepchniętego celu<input type="number" min={0} max={Math.floor(actor.speed / 2)} value={value.brutalFeet ?? 0} onChange={e => onChange({ ...value, brutalFeet: Number(e.target.value) })} /></label>}</>}
    {p.divineFury && <>{dice('divineRolls', multiplier, 6, 'Divine Fury')}<label>Typ obrażeń<select required value={value.divineType ?? ''} onChange={e => onChange({ ...value, divineType: e.target.value })}><option value="">Wybierz...</option><option value="nekrotyczne">Necrotic</option><option value="promieniste">Radiant</option></select></label></>}
    {actor.rage?.power === 'ram' && p.attack.melee && <label><input type="checkbox" checked={value.ram ?? false} onChange={e => onChange({ ...value, ram: e.target.checked })} />Ram — powal cel Large lub mniejszy</label>}
    {actor.rageProfile?.worldTree && (actor.level ?? 0) >= 10 && p.attack.roots && <><label>Battering Roots<select value={value.roots ?? ''} onChange={e => onChange({ ...value, roots: e.target.value })}><option value="">Nie używaj</option><option value="push">Push do 10 stóp</option><option value="topple">Topple — rzut CON celu</option></select></label>{value.roots === 'topple' && <><label>CON celu: k20<input required type="number" min={1} max={20} value={value.rootSave?.roll ?? ''} onChange={e => onChange({ ...value, rootSave: { ...value.rootSave, roll: Number(e.target.value) } })} /></label><label>Druga k20, jeśli wymagana<input type="number" min={1} max={20} value={value.rootSave?.roll2 ?? ''} onChange={e => onChange({ ...value, rootSave: { ...value.rootSave, roll2: Number(e.target.value) } })} /></label></>}</>}
    {(value.roots || value.brutalEffects?.includes('forceful')) && <label><input type="checkbox" checked={value.confirmed ?? false} onChange={e => onChange({ ...value, confirmed: e.target.checked })} />MG potwierdza zasięg, rozmiar celu i geometrię przesunięcia.</label>}
  </>;
}
