import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api';
import { Card } from '../../components/ui/Card';
import type { Attack, CombatResponse } from './battle-types';
import definitions from '../../../shared/statistics.json' with { type: 'json' };
import { SpellCastForm, SpellResolution, ConcentrationForm, SpellDefenses } from './CombatSpellForms';

export function useBattle(gameId: number, sessionId: number) {
  const [response, setResponse] = useState<CombatResponse | null>(null);
  const [error, setError] = useState('');
  const [connectionError, setConnectionError] = useState('');
  const [pending, setPending] = useState(false);
  const refresh = useCallback(async () => {
    const data = await api<CombatResponse>(`/games/${gameId}/battle`);
    setResponse(previous => (data.battle?.version ?? 0) >= (previous?.battle?.version ?? 0) ? data : previous);
  }, [gameId]);
  useEffect(() => {
    let alive = true, running = false;
    const load = async () => {
      if (running) return;
      running = true;
      try { const data = await api<CombatResponse>(`/games/${gameId}/battle`); if (alive) { setResponse(previous => (data.battle?.version ?? 0) >= (previous?.battle?.version ?? 0) ? data : previous); setConnectionError(''); } }
      catch (e) { if (alive) setConnectionError(e instanceof Error ? e.message : 'Błąd połączenia z walką.'); }
      finally { running = false; }
    };
    void load();
    const timer = window.setInterval(() => void load(), 2000);
    window.addEventListener('focus', load);
    return () => { alive = false; window.clearInterval(timer); window.removeEventListener('focus', load); };
  }, [gameId, sessionId]);
  async function mutate(action: 'start' | 'act' | 'next' | 'end', body: Record<string, unknown> = {}) {
    if (pending || !response) return false;
    setPending(true); setError('');
    try {
      const data = await api<CombatResponse>(`/games/${gameId}/battle/${action}`, { ...body, sessionId, version: response.battle?.version ?? 0 });
      setResponse(previous => (data.battle?.version ?? 0) >= (previous?.battle?.version ?? 0) ? data : previous); return true;
    } catch (e) {
      try { await refresh(); } catch { /* Preserve the mutation failure. */ }
      setError(e instanceof Error ? e.message : 'Nie udało się zapisać działania.'); return false;
    } finally { setPending(false); }
  }
  async function retry() {
    try { await refresh(); setError(''); setConnectionError(''); }
    catch (e) { setConnectionError(e instanceof Error ? e.message : 'Nie udało się wczytać walki.'); }
  }
  return { response, error: error || connectionError, pending, mutate, retry };
}
type Controller = ReturnType<typeof useBattle>;
const signed = (n: number) => n >= 0 ? `+${n}` : String(n);

export function LiveBattle({ controller, onReturnToExploration }: { controller: Controller; onReturnToExploration?: () => void }) {
  const { response, error, pending, mutate } = controller;
  const battle = response?.battle;
  if (!battle || !response) return error ? <p role="alert" className="form-error">{error}</p> : null;
  if (!battle.active) return <BattleSummary controller={controller} onReturnToExploration={onReturnToExploration} />;
  const actor = battle.fighters[battle.turn];
  const controls = response.controlledIds.includes(actor.id);
  return <section aria-label="Aktywna walka">
    <header className="page-heading"><p className="eyebrow">WSPÓLNA WALKA</p><h1>Runda {battle.round}</h1><p role="status">Tura: <strong>{actor.name}</strong> · {controls ? 'Wybierz działanie lub zakończ turę.' : 'Czekasz na działanie uczestnika.'}</p></header>
    {error && <p role="alert" className="form-error">{error}</p>}
    {battle.fighters.filter(f => f.concentrationDC && response.controlledIds.includes(f.id)).map(f => <Card key={`${f.id}-${f.concentrationChecks?.length}`} title="Sprawdzenie koncentracji"><ConcentrationForm actor={f} controller={controller} /></Card>)}
    {response.gm && !battle.fighters.some(f => !f.characterId) && <EndBattlePrompt key={`${battle.sessionId}-${battle.startedAt ?? 0}`} controller={controller} />}
    <div className="battle-toolbar">
      {(response.gm || controls) && <button className="primary-button" disabled={pending || Boolean(battle.pending && !response.gm)} onClick={() => { if (!battle.pending || window.confirm('Pominąć nierozstrzygnięte działanie i przejść dalej?')) void mutate('next'); }}>{response.gm ? 'Następna tura' : 'Zakończ turę'}</button>}
      {response.gm && <button className="text-button danger-button" disabled={pending} onClick={() => { if (window.confirm('Zakończyć walkę? Zapisane obrażenia pozostaną na kartach postaci.')) void mutate('end'); }}>Zakończ walkę</button>}
    </div>
    {battle.pending?.kind === 'damage' && <Card title={battle.pending.critical ? 'Trafienie krytyczne — obrażenia' : 'Trafienie — obrażenia'}>
      {controls ? <DamageForm key={`${battle.version}-damage`} controller={controller} /> : <p>Oczekiwanie na rzuty obrażeń atakującego.</p>}
    </Card>}
    {battle.pending?.kind === 'waiting' && <p role="status">GM rozstrzyga działanie potwora.</p>}
    {battle.pending?.kind === 'spell' && <Card title="Rozliczenie czaru"><SpellResolution key={`${battle.pending.actorId}-${battle.pending.spellName}-${battle.pending.stage}-${battle.pending.targets.filter(t => t.saved !== undefined).length}`} controller={controller} /></Card>}
    {battle.pending?.kind === 'spell' && response.gm && <SpellDefenses controller={controller} />}
    <SpellReactions controller={controller} />
    {battle.pending?.kind === 'request' && <Card title="Rozstrzygnięcie GM"><p>{battle.fighters.find(f => f.id === battle.pending?.actorId)?.name}: {battle.pending.description}</p>{battle.pending.roll && <p>Wynik k20: {battle.pending.roll}</p>}{response.gm ? <ResolveForm controller={controller} /> : <p>GM rozstrzyga działanie.</p>}</Card>}
    {controls && !battle.pending && (actor.hp > 0 ? <TurnForm key={`${actor.id}-${battle.round}`} controller={controller} /> : actor.characterId && actor.deathFailures < 3 && actor.deathSuccesses < 3 && !actor.action ? <DeathForm controller={controller} /> : <p>Uczestnik jest {actor.deathFailures >= 3 ? 'martwy' : actor.deathSuccesses >= 3 ? 'ustabilizowany' : 'niezdolny do działania'}. Możesz zakończyć turę.</p>)}
    {!battle.pending && response.controlledIds.some(id => id !== actor.id && battle.fighters.some(f => f.id === id && f.hp > 0 && !f.reaction)) && <ReactionForm controller={controller} />}
    {response.gm && !battle.pending && <details><summary>Rozstrzygnięcie GM: obrażenia lub leczenie</summary><ResolveForm controller={controller} /></details>}
    <div className="session-characters gm-character-row">{battle.fighters.map((f, index) => <div key={f.id} className={index === battle.turn ? 'battle-current' : ''}><Card title={`${index + 1}. ${f.name}`} eyebrow={f.hidden ? 'POTWÓR' : `${f.characterId ? 'POSTAĆ' : 'POTWÓR'} · INICJATYWA ${f.initiative}`}>
      {f.hidden ? <dl className="gm-vitals"><div><dt>Otrzymane obrażenia</dt><dd>{f.damageTaken ?? 0}</dd></div></dl> : <>
      <dl className="gm-vitals">{[['PW', `${f.hp} / ${f.maxHp}`], ...(f.ac === null ? [] : [['KP', f.ac]]), ['Tymczasowe PW', f.tempHp], ['Ruch', `${f.moved} / ${f.speed + f.extraMove}`]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      <dl className="gm-secondary"><div><dt>Akcja</dt><dd>{f.action || 'Dostępna'}</dd></div><div><dt>Bonusowa</dt><dd>{f.bonus || 'Dostępna'}</dd></div><div><dt>Reakcja</dt><dd>{f.reaction || 'Dostępna'}</dd></div>{f.characterId && f.hp === 0 && <div><dt>Rzuty przeciw śmierci</dt><dd>{f.deathSuccesses} sukcesy / {f.deathFailures} porażki</dd></div>}</dl>
      <dl className="gm-secondary gm-exploration">{definitions.abilities.map(a => <div key={a.id}><dt>Rzut obronny: {a.short}</dt><dd>{f.saves[a.id] == null ? '—' : signed(f.saves[a.id]!)}</dd></div>)}</dl>
      {f.dodge && <p>Unik: utrudnienie ataków.</p>}{f.action === 'Atak' && f.attacksLeft > 0 && <p>Pozostałe ataki: {f.attacksLeft}</p>}
      {f.concentration && <p>Koncentracja: {f.concentration}</p>}
      {f.notes && <details><summary>Ataki i zdolności</summary><p className="item-description">{f.notes}</p></details>}
      </>}
    </Card></div>)}</div>
    <details open><summary>Dziennik walki</summary><ol className="battle-log">{battle.log.map((entry, index) => <li key={index}>{entry}</li>)}</ol></details>
  </section>;
}

function EndBattlePrompt({ controller }: { controller: Controller }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return <div role="alertdialog" aria-labelledby="end-battle-question" className="card"><h2 id="end-battle-question">Na polu bitwy nie ma już potworów. Zakończyć walkę?</h2><div className="battle-toolbar"><button className="primary-button" disabled={controller.pending} onClick={() => void controller.mutate('end')}>Tak, zakończ i pokaż podsumowanie</button><button className="text-button" disabled={controller.pending} onClick={() => setDismissed(true)}>Kontynuuj walkę</button></div></div>;
}

function BattleSummary({ controller, onReturnToExploration }: { controller: Controller; onReturnToExploration?: () => void }) {
  const b = controller.response!.battle!;
  const defeated = b.defeatedMonsters ?? [];
  return <section aria-labelledby="battle-summary-title"><header className="page-heading"><p className="eyebrow">WALKA ZAKOŃCZONA</p><h1 id="battle-summary-title">Podsumowanie walki</h1></header>
    {onReturnToExploration && <button className="primary-button battle-start" onClick={onReturnToExploration}>Powrót</button>}
    {controller.error && <p role="alert" className="form-error">{controller.error}</p>}
    <dl className="gm-vitals"><div><dt>Liczba rund</dt><dd>{b.summary?.rounds ?? b.round}</dd></div><div><dt>Pokonane potwory</dt><dd>{b.summary?.defeatedMonsterCount ?? defeated.length}</dd></div><div><dt>Potwory pozostałe na polu bitwy</dt><dd>{b.summary?.remainingMonsterCount ?? b.fighters.filter(f => f.hidden || !f.characterId).length}</dd></div></dl>
    <Card title="Postacie po walce"><ul>{b.fighters.filter(f => f.characterId).map(f => <li key={f.id}><strong>{f.name}</strong> · {f.hp}/{f.maxHp} PW{f.deathFailures >= 3 ? ' · Śmierć' : f.hp === 0 ? ' · Nieprzytomność' : ''}</li>)}</ul></Card>
    {!!defeated.length && <Card title="Pokonane potwory"><ul>{defeated.map(f => <li key={f.id}>{f.name}{f.damageTaken == null ? '' : ` · ${f.damageTaken} otrzymanych obrażeń`}</li>)}</ul></Card>}
    <details open><summary>Dziennik walki</summary><ol className="battle-log">{b.log.map((entry, i) => <li key={i}>{entry}</li>)}</ol></details>
  </section>;
}

function TurnForm({ controller }: { controller: Controller }) {
  const b = controller.response!.battle!, actor = b.fighters[b.turn];
  const slot = !actor.action || actor.action === 'Atak' && actor.attacksLeft > 0 ? 'action' : !actor.bonus ? 'bonus' : !actor.reaction && !actor.reactionDeferred ? 'reaction' : null;
  if (!slot) return <Card title="Działania tury zakończone"><p>Wykorzystano lub pominięto wszystkie kroki tury.</p><button className="primary-button" disabled={controller.pending} onClick={() => void controller.mutate('next')}>Zakończ turę</button></Card>;
  return <TurnStepForm key={slot} controller={controller} slot={slot} />;
}

function TurnStepForm({ controller, slot }: { controller: Controller; slot: 'action' | 'bonus' | 'reaction' }) {
  const { response, pending, mutate } = controller;
  const b = response!.battle!, actor = b.fighters[b.turn];
  const availableAttacks = actor.attacks.filter(attack => slot !== 'bonus' || (attack.light && actor.usedWeapons.some(id => id !== attack.id && actor.attacks.find(used => used.id === id)?.light)));
  const canAttack = slot !== 'reaction' && (actor.characterId ? availableAttacks.length > 0 : slot === 'action');
  const [kind, setKind] = useState(canAttack ? 'attack' : 'request');
  const [attackId, setAttackId] = useState(availableAttacks[0]?.id ?? '');
  const [targetId, setTargetId] = useState('');
  const [roll, setRoll] = useState('');
  const [roll2, setRoll2] = useState('');
  const [advantage, setAdvantage] = useState(false);
  const [manualDisadvantage, setManualDisadvantage] = useState(false);
  const [description, setDescription] = useState('');
  const [feet, setFeet] = useState('');
  const [monsterAttack, setMonsterAttack] = useState<Attack>({ id: 'monster', name: 'Atak potwora', bonus: 0, dice: 1, sides: 6, damageBonus: 0, type: '', light: false });
  const attack = actor.characterId ? availableAttacks.find(a => a.id === attackId) : monsterAttack;
  const target = b.fighters.find(f => f.id === targetId);
  const disadvantage = Boolean(attack?.disadvantage || target?.dodge || target?.attackDisadvantage || manualDisadvantage || actor.mockery);
  const steps = [{ id: 'action', label: 'Akcja' }, { id: 'bonus', label: 'Akcja dodatkowa' }, { id: 'reaction', label: 'Reakcja' }] as const;
  const choices = [
    ...(canAttack ? [{ id: 'attack', label: 'Atak' }] : []),
    ...(slot === 'action' ? [{ id: 'move', label: 'Ruch' }, { id: 'dash', label: 'Zryw' }, { id: 'dodge', label: 'Unik' }, { id: 'disengage', label: 'Wycofanie' }, { id: 'help', label: 'Pomoc' }] : []),
    ...(actor.spellcasting?.spells.some(s => s.action === slot) ? [{ id: 'spell', label: 'Rzuć czar' }] : []),
    { id: 'request', label: 'Zdolność / inne' },
  ];
  return <Card title={`${steps.find(step => step.id === slot)!.label}: ${actor.name}`}>
    <ol className="battle-turn-steps" aria-label="Kroki tury">{steps.map(step => <li key={step.id} aria-current={step.id === slot ? 'step' : undefined}>{step.label}</li>)}</ol>
    {slot === 'action' && actor.action === 'Atak' && <p>Pozostałe ataki w tej akcji: {actor.attacksLeft}. Wykonaj kolejny atak albo przejdź dalej.</p>}
    {actor.spellcasting && !actor.spellcasting.spells.length && actor.spellcasting.slots.length > 0 && <p>Brak wybranych czarów. Przygotuj je na karcie postaci w zakładce Statystyki.</p>}
    <div className="battle-action-choices" role="group" aria-label="Wybierz działanie">{choices.map(choice => <button type="button" className={kind === choice.id ? 'primary-button' : 'text-button'} aria-pressed={kind === choice.id} disabled={pending || (slot === 'action' && actor.action === 'Atak' && choice.id !== 'attack')} key={choice.id} onClick={() => setKind(choice.id)}>{choice.label}</button>)}</div>
    {kind === 'spell' ? <><SpellCastForm controller={controller} actor={actor} slot={slot} /><button className="text-button" disabled={pending} onClick={() => void mutate('act', { kind: 'skip', slot })}>Pomiń ten krok</button></> : <form className="stack-form" onSubmit={async e => {
    e.preventDefault();
    const ok = await mutate('act', { kind, slot, attackId, targetId, roll: roll ? Number(roll) : null, roll2: roll2 ? Number(roll2) : null, advantage, disadvantage: manualDisadvantage, description, feet: Number(feet), ...(!actor.characterId ? { attack: monsterAttack } : {}) });
    if (ok) { setRoll(''); setRoll2(''); setDescription(''); setFeet(''); }
  }}>
    {kind === 'attack' && <>
      {actor.characterId ? <label>Broń<select required value={attackId} onChange={e => setAttackId(e.target.value)}>{availableAttacks.map(a => <option key={a.id} value={a.id}>{a.name} · atak {signed(a.bonus)} · {a.dice ? `${a.dice}k${a.sides}` : ''}{signed(a.damageBonus)}</option>)}</select></label> : <><p>Wpisz parametry ataku z opisu potwora. Zdolności specjalne rozstrzygnij przez „inne”.</p><label>Nazwa ataku<input required maxLength={80} value={monsterAttack.name} onChange={e => setMonsterAttack({ ...monsterAttack, name: e.target.value })} /></label><div className="battle-fields">{(['bonus', 'dice', 'sides', 'damageBonus'] as const).map(field => <label key={field}>{({ bonus: 'Premia ataku', dice: 'Liczba kości', sides: 'Ściany kości', damageBonus: 'Premia obrażeń' })[field]}<input required type="number" min={field === 'dice' || field === 'sides' ? 0 : -30} max={field === 'bonus' ? 40 : field === 'dice' ? 20 : 100} value={monsterAttack[field]} onChange={e => setMonsterAttack({ ...monsterAttack, [field]: Number(e.target.value) })} /></label>)}</div></>}
      <label>Cel<select required value={targetId} onChange={e => setTargetId(e.target.value)}><option value="">Wybierz cel</option>{b.fighters.filter(f => f.id !== actor.id && (f.hidden || f.deathFailures < 3)).map(f => <option key={f.id} value={f.id}>{f.name} · KP {f.ac}</option>)}</select></label>
      <label>Wynik k20 (bez premii)<input required type="number" min={1} max={20} value={roll} onChange={e => setRoll(e.target.value)} /></label>
      <label className="battle-check"><input type="checkbox" checked={advantage} onChange={e => setAdvantage(e.target.checked)} />Ułatwienie (ustalone z GM)</label>
      <label className="battle-check"><input type="checkbox" checked={manualDisadvantage} onChange={e => setManualDisadvantage(e.target.checked)} />Utrudnienie sytuacyjne (ustalone z GM)</label>
      {Boolean(attack?.disadvantage || target?.dodge || target?.attackDisadvantage) && <p>Atak wymaga utrudnienia z powodu broni, pancerza lub sytuacji celu.</p>}
      {disadvantage && advantage && <p>Ułatwienie i utrudnienie znoszą się. Użyj jednego k20.</p>}
      {disadvantage !== advantage && <label>Drugi k20 · {disadvantage ? 'utrudnienie' : 'ułatwienie'}<input required type="number" min={1} max={20} value={roll2} onChange={e => setRoll2(e.target.value)} /></label>}
    </>}
    {kind === 'move' && <label>Ruch w stopach (pozostało {Math.max(0, actor.speed + actor.extraMove - actor.moved)})<input required type="number" min={1} max={Math.max(1, actor.speed + actor.extraMove - actor.moved)} value={feet} onChange={e => setFeet(e.target.value)} /></label>}
    {kind === 'request' && <><label>Opis czaru / zdolności, cel i oczekiwany efekt<textarea required maxLength={1000} value={description} onChange={e => setDescription(e.target.value)} /></label><label>Wynik k20 (jeśli GM wymaga rzutu)<input type="number" min={1} max={20} value={roll} onChange={e => setRoll(e.target.value)} /></label></>}
    {slot === 'bonus' && <p>Akcja bonusowa wymaga odpowiedniej zdolności. Atak inną lekką bronią jest dostępny po ataku lekką bronią w tej turze.</p>}
    <div className="battle-toolbar"><button className="primary-button" disabled={pending || (kind === 'attack' && !attack)}>Użyj wybranej opcji</button><button type="button" className="text-button" disabled={pending} onClick={() => void mutate('act', { kind: 'skip', slot })}>{slot === 'action' && actor.action === 'Atak' ? 'Pomiń pozostałe ataki' : 'Pomiń ten krok'}</button></div>
  </form>}</Card>;
}
function DamageForm({ controller }: { controller: Controller }) {
  const p = controller.response!.battle!.pending!;
  const [rolls, setRolls] = useState<string[]>([]);
  if (p.kind !== 'damage') return null;
  const count = p.attack.dice * (p.critical ? 2 : 1);
  return <form className="stack-form" onSubmit={e => { e.preventDefault(); void controller.mutate('act', { kind: 'damage', rolls: Array.from({ length: count }, (_, i) => Number(rolls[i])) }); }}>
    <p>{p.attack.name}: {count ? `${count}k${p.attack.sides}` : 'Stałe obrażenia'} {signed(p.attack.damageBonus)}. Podaj same wyniki kości; premia zostanie dodana automatycznie.</p>
    <div className="battle-fields">{Array.from({ length: count }, (_, i) => <label key={i}>Kość {i + 1} (k{p.attack.sides})<input required type="number" min={1} max={p.attack.sides} value={rolls[i] ?? ''} onChange={e => setRolls(previous => { const next = [...previous]; next[i] = e.target.value; return next; })} /></label>)}</div>
    <button className="primary-button" disabled={controller.pending}>Zastosuj obrażenia</button>
  </form>;
}
function ResolveForm({ controller }: { controller: Controller }) {
  const [note, setNote] = useState('');
  const [targetId, setTargetId] = useState('');
  const [effect, setEffect] = useState('damage');
  const [amount, setAmount] = useState('');
  return <form className="stack-form" onSubmit={async e => { e.preventDefault(); if (await controller.mutate('act', { kind: 'resolve', note, targetId, effect, amount: Number(amount) })) { setNote(''); setAmount(''); } }}>
    <label>Rozstrzygnięcie (uwzględnij rzuty obronne, odporności i zdolności)<textarea required maxLength={1000} value={note} onChange={e => setNote(e.target.value)} /></label>
    <label>Cel zmiany PW<select value={targetId} onChange={e => setTargetId(e.target.value)}><option value="">Bez zmiany PW</option>{controller.response!.battle!.fighters.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
    {targetId && <><label>Efekt<select value={effect} onChange={e => setEffect(e.target.value)}><option value="damage">Obrażenia</option><option value="heal">Leczenie</option></select></label><label>Końcowa wartość po uwzględnieniu zasad<input required type="number" min={0} max={9999} value={amount} onChange={e => setAmount(e.target.value)} /></label></>}
    <button className="primary-button" disabled={controller.pending}>Zastosuj rozstrzygnięcie</button>
  </form>;
}
function DeathForm({ controller }: { controller: Controller }) {
  const [roll, setRoll] = useState('');
  return <form className="stack-form" onSubmit={e => { e.preventDefault(); void controller.mutate('act', { kind: 'death', roll: Number(roll) }); }}><label>Rzut przeciw śmierci (k20)<input required type="number" min={1} max={20} value={roll} onChange={e => setRoll(e.target.value)} /></label><button className="primary-button" disabled={controller.pending}>Rozstrzygnij rzut</button></form>;
}
function ReactionForm({ controller }: { controller: Controller }) {
  const b = controller.response!.battle!;
  const [actorId, setActorId] = useState('');
  const [description, setDescription] = useState('');
  return <details><summary>Zgłoś reakcję poza swoją turą</summary><form className="stack-form" onSubmit={async e => { e.preventDefault(); if (await controller.mutate('act', { kind: 'request', slot: 'reaction', actorId, description })) setDescription(''); }}>
    <label>Uczestnik<select required value={actorId} onChange={e => setActorId(e.target.value)}><option value="">Wybierz</option>{b.fighters.filter(f => f.id !== b.fighters[b.turn].id && controller.response!.controlledIds.includes(f.id) && f.hp > 0 && !f.reaction).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
    <label>Reakcja i jej wyzwalacz<textarea required maxLength={1000} value={description} onChange={e => setDescription(e.target.value)} /></label><button className="primary-button" disabled={controller.pending}>Przekaż do GM</button>
  </form></details>;
}

function SpellReactions({ controller }: { controller: Controller }) {
  const b = controller.response!.battle!;
  const candidates = b.fighters.filter(f => controller.response!.controlledIds.includes(f.id) && f.hp > 0 && !f.reaction && f.spellcasting?.spells.some(s => s.action === 'reaction'));
  const [selected, setSelected] = useState('');
  const actor = candidates.find(f => f.id === selected) ?? candidates[0];
  if (!actor) return null;
  return <details><summary>Czar jako reakcja — po spełnieniu wyzwalacza</summary><div className="stack-form"><label>Postać<select value={actor.id} onChange={e => setSelected(e.target.value)}>{candidates.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label></div><SpellCastForm key={actor.id} controller={controller} actor={actor} slot="reaction" /></details>;
}
