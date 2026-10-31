import { randomId } from '../../lib/id';
import { useEffect, useState } from 'react';
import { LiveBattle, useBattle } from './LiveBattle';
import type { GameMember } from './GameMemberCard';
import { Card } from '../../components/ui/Card';

import { readMonsters, type Enemy } from './monster-library';
type Fighter = { id: string; name: string; memberId?: number; enemy?: Enemy; initiative: string; hp: number | null };
type Battle = { stage: 'enemies' | 'players' | 'initiative' | 'battle'; fighters: Fighter[]; round: number; turn: number };
const initial: Battle = { stage: 'enemies', fighters: [], round: 1, turn: 0 };

export function BattlePage({ members, sessionId, gameId, userId }: { members: GameMember[]; sessionId: number; gameId: number; userId: number }) {
  const controller = useBattle(gameId, sessionId);
  const [error, setError] = useState('');
  const [battle, setBattle] = useState<Battle>(initial);
  const [library, setLibrary] = useState<Enemy[]>([]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState('');
  const [preparingNew, setPreparingNew] = useState(false);
  useEffect(() => { if (controller.response?.battle?.active) setPreparingNew(false); }, [controller.response?.battle?.active]);
  useEffect(() => {
    async function load() {
      try { setLibrary(await readMonsters(userId, gameId)); }
      catch { setError('Nie udało się odczytać katalogu potworów.'); }
    }
    load();
    window.addEventListener('focus', load);
    window.addEventListener('storage', load);
    return () => { window.removeEventListener('focus', load); window.removeEventListener('storage', load); };
  }, [userId, gameId]);
  const participants = members.filter(m => m.participating && m.status === 'accepted');
  const missing = battle.fighters.some(f => f.memberId !== undefined && !participants.some(m => m.id === f.memberId));
  function update(id: string, patch: Partial<Fighter>) { setBattle(b => ({ ...b, fighters: b.fighters.map(f => f.id === id ? { ...f, ...patch } : f) })); }
  function stage(next: Battle['stage']) { setBattle(b => ({ ...b, stage: next })); }
  if (controller.response?.battle?.active) return <><a className="text-button" href={`?gmGame=${gameId}`}>← Sesja</a><LiveBattle controller={controller} onReturnToExploration={() => window.location.assign(`?gmGame=${gameId}`)} /></>;
  if (controller.response?.battle && !preparingNew) return <><a className="text-button" href={`?gmGame=${gameId}`}>← Sesja</a><LiveBattle controller={controller} onReturnToExploration={() => window.location.assign(`?gmGame=${gameId}`)} /><button className="primary-button" onClick={() => { setBattle(initial); setPreparingNew(true); }}>Przygotuj następną walkę</button></>;
  if (!controller.response) return <><a className="text-button" href={`?gmGame=${gameId}`}>← Wróć do sesji</a>{controller.error ? <><p role="alert" className="form-error">{controller.error}</p><button className="primary-button" onClick={() => void controller.retry()}>Ponów wczytanie walki</button></> : <p role="status">Wczytywanie zapisanej walki…</p>}</>;
  return <>
    <header className="page-heading"><a className="text-button" href={`?gmGame=${gameId}`}>← Wróć do sesji</a><p className="eyebrow">PANEL GM / WALKA</p><h1>{battle.stage === 'battle' ? `Bitwa · Runda ${battle.round}` : 'Przygotowanie walki'}</h1>
      <p>Walka jest zapisywana w Firebase. Możesz wrócić do niej po odświeżeniu lub opuszczeniu strony.</p>
    </header>
    {(error || controller.error) && <p role="alert" className="form-error">{error || controller.error}</p>}
    {missing && <p role="alert" className="form-error">Jedna z wybranych postaci opuściła sesję. Wróć do wyboru postaci i usuń ją z walki.</p>}
    {battle.stage === 'enemies' && <Card title="1. Przeciwnicy">
      <div className="stack-form"><label>Wyszukaj przeciwnika<input type="search" value={query} onChange={e => { setQuery(e.target.value); setSelected(''); }} /></label>
        <label>Przeciwnik z katalogu<select value={selected} onChange={e => setSelected(e.target.value)}><option value="">Wybierz przeciwnika</option>{library.filter(e => e.name.toLocaleLowerCase('pl').includes(query.toLocaleLowerCase('pl'))).map(e => <option key={e.id} value={e.id}>{e.name} · KP {e.ac} · PW {e.hp}</option>)}</select></label>
        {!library.length && <p>Ta gra nie ma jeszcze potworów. Dodaj je na podstronie „Potwory”.</p>}
        <a className="text-button" href={`?gmGame=${gameId}&monsters=1`}>Zarządzaj potworami tej gry</a>
        <button className="primary-button" disabled={!selected} onClick={() => { const enemy = library.find(e => e.id === selected); if (enemy) setBattle(b => ({ ...b, fighters: [...b.fighters, { id: randomId(), name: enemy.name, enemy, initiative: '', hp: enemy.hp }] })); }}>Dodaj przeciwnika do walki</button>
      </div>
      <ol>{battle.fighters.map((f, index) => <li key={f.id}>{f.name} · #{index + 1} <button className="text-button" onClick={() => setBattle(b => ({ ...b, fighters: b.fighters.filter(v => v.id !== f.id) }))}>Usuń</button></li>)}</ol>
      <button className="primary-button" disabled={!battle.fighters.some(f => f.enemy)} onClick={() => stage('players')}>Dalej: postacie</button>
    </Card>}
    {battle.stage === 'players' && <Card title="2. Postacie z aktywnej sesji"><div className="stack-form">
      {members.filter(m => m.participating || battle.fighters.some(f => f.memberId === m.id)).map(m => <label className="battle-check" key={m.id}><input type="checkbox" disabled={!m.participating && !battle.fighters.some(f => f.memberId === m.id)} checked={battle.fighters.some(f => f.memberId === m.id)} onChange={e => setBattle(b => ({ ...b, fighters: e.target.checked ? [...b.fighters, { id: randomId(), memberId: m.id, name: m.name, initiative: '', hp: m.statistics?.hp ?? null }] : b.fighters.filter(f => f.memberId !== m.id) }))} />{m.name} · {m.playerName}{!m.participating && ' (poza sesją)'}</label>)}
      {battle.fighters.filter(f => f.memberId !== undefined && !members.some(m => m.id === f.memberId)).map(f => <p key={f.id}>{f.name} · poza grą <button className="text-button" onClick={() => setBattle(b => ({ ...b, fighters: b.fighters.filter(v => v.id !== f.id) }))}>Usuń z walki</button></p>)}
      {!participants.length && <p>Brak postaci w aktywnej sesji.</p>}
      <button className="text-button" onClick={() => stage('enemies')}>← Przeciwnicy</button><button className="primary-button" disabled={missing || !battle.fighters.some(f => f.memberId !== undefined)} onClick={() => stage('initiative')}>Dalej: inicjatywa</button>
    </div></Card>}
    {battle.stage === 'initiative' && <Card title="3. Inicjatywa"><form className="stack-form" onSubmit={async e => { e.preventDefault(); if (missing || battle.fighters.some(f => !f.initiative.trim() || !Number.isInteger(Number(f.initiative)))) return; if (await controller.mutate('start', { fighters: battle.fighters.map(f => ({ memberId: f.memberId, enemyId: f.enemy?.id, initiative: Number(f.initiative) })) })) setBattle(initial); }}>
      <p>Wpisz końcowe wyniki rzutów z premiami. Przy remisie zachowana zostanie kolejność dodawania uczestników.</p>
      {battle.fighters.map((f, i) => <label key={f.id}>{f.name} · #{i + 1}<input required type="number" min={-99} max={99} value={f.initiative} onChange={e => update(f.id, { initiative: e.target.value })} /></label>)}
      <button type="button" className="text-button" onClick={() => stage('players')}>← Postacie</button><button className="primary-button" disabled={missing}>Rozpocznij bitwę</button>
    </form></Card>}
  </>;
}
