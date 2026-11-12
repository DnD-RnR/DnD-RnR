import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api';
import type { GameMember } from './GameMemberCard';
import { AdvancementHistory, type Advancement } from '../game/AdvancementTab';

export function MilestoneControls({ gameId, members, onChanged }: { gameId: number; members: GameMember[]; onChanged: () => Promise<void> }) {
  const [entries, setEntries] = useState<Advancement[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const path = `/games/${gameId}/advancements`;
  const load = useCallback(async () => { const result = await api<{ advancements: Advancement[] }>(path); setEntries(result.advancements); }, [path]);
  useEffect(() => { void load().catch(e => setError(e.message)); }, [load, members]);
  const eligible = members.filter(m => m.status === 'accepted' && m.character && m.character.level < 20 && !entries.some(a => a.characterId === m.character!.id && a.status === 'pending'));
  async function mutate(action: string, body: unknown) {
    if (pending) return;
    setPending(true); setError(''); setMessage('');
    try { await api(`${path}${action}`, body); await load(); await onChanged(); setSelected([]); setMessage(action ? 'Rozwój postaci zaktualizowany.' : 'Awans przyznany. Gracze mogą teraz rozwinąć postacie w zakładce Rozwój.'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Nie udało się zapisać awansu.'); }
    finally { setPending(false); }
  }
  const selectedCount = eligible.filter(m => selected.includes(m.character!.id)).length;
  const allSelected = eligible.length > 0 && selectedCount === eligible.length;
  return <section className="equipment-section milestone-controls"><div className="milestone-heading"><span className="milestone-emblem" aria-hidden="true">↑</span><div><p className="eyebrow">KOLEJNY ROZDZIAŁ PRZYGODY</p><h2>Przyznaj poziom</h2><p>Nagród bohaterów za osiągnięty kamień milowy.</p></div></div>
    {error && <p role="alert" className="form-error">{error}</p>}{message && <p role="status">{message}</p>}
    <form className="stack-form milestone-form" onSubmit={e => { e.preventDefault(); void mutate('', { characterIds: selected.filter(id => eligible.some(m => m.character!.id === id)), reason }); }}>
      <fieldset disabled={pending} className="milestone-party"><legend>1. Wybierz bohaterów</legend><div className="milestone-party-toolbar"><span>{selectedCount} z {eligible.length} wybranych</span><button className="text-button" type="button" disabled={!eligible.length} onClick={() => setSelected(allSelected ? [] : eligible.map(m => m.character!.id))}>{allSelected ? 'Odznacz drużynę' : 'Wybierz całą drużynę'}</button></div>
        <div className="milestone-party-grid">{eligible.length ? eligible.map(m => <label className={`milestone-choice${selected.includes(m.character!.id) ? ' is-selected' : ''}`} key={m.id}><input type="checkbox" checked={selected.includes(m.character!.id)} onChange={e => setSelected(ids => e.target.checked ? [...ids, m.character!.id] : ids.filter(id => id !== m.character!.id))} /><span className="milestone-character"><strong>{m.name}</strong><small>{m.character!.class.replace(/\s*\([^)]*\)/g, '')} · {m.playerName}</small></span><span className="milestone-level" aria-label={`Poziom ${m.character!.level} na ${m.character!.level + 1}`}><span>{m.character!.level}</span><span aria-hidden="true">→</span><strong>{m.character!.level + 1}</strong></span></label>) : <p className="milestone-empty">Wszyscy bohaterowie oczekują już na awans lub osiągnęli poziom 20.</p>}</div>
      </fieldset>
      <fieldset disabled={pending} className="milestone-reason"><legend>2. Opisz kamień milowy</legend><label htmlFor={`milestone-reason-${gameId}`}>Za co drużyna otrzymuje poziom?<textarea id={`milestone-reason-${gameId}`} aria-describedby={`milestone-reason-hint-${gameId}`} required maxLength={500} rows={4} value={reason} onChange={e => setReason(e.target.value)} placeholder="Ocalenie wioski i pokonanie nekromanty…" /></label><div className="milestone-field-hint"><small id={`milestone-reason-hint-${gameId}`}>Ten opis trafi do historii rozwoju postaci.</small><small>{reason.length} / 500</small></div></fieldset>
      <div className="milestone-footer"><p>{selectedCount ? <>Awans o <strong>1 poziom</strong> dla {selectedCount} postaci.<br />Gracze dokończą rozwój na swoich kartach.</> : 'Wybierz bohaterów i opisz ich osiągnięcie.'}</p><button className="primary-button" disabled={pending || !selectedCount || !reason.trim()}>{pending ? 'Zapisywanie…' : 'Przyznaj poziom'} <span aria-hidden="true">↑</span></button></div>
    </form>
    {!!entries.length && <details className="milestone-history"><summary>Historia awansów drużyny <span>({entries.length})</span></summary><div className="milestone-history-grid">{entries.map(entry => <div key={entry.id} className="milestone-entry"><h3>{entry.characterName}</h3><AdvancementHistory entries={[entry]} />{entry.status === 'pending' && <button className="text-button danger-button" disabled={pending} onClick={() => { if (window.confirm(`Anulować oczekujący awans postaci ${entry.characterName}?`)) void mutate(`/${entry.id}/cancel`, {}); }}>Anuluj przyznany awans</button>}{entry.status === 'completed' && <button className="text-button danger-button" disabled={pending} onClick={() => { if (window.confirm(`Cofnąć awans postaci ${entry.characterName}? Jest to możliwe tylko dla ostatniego awansu, jeżeli karta i zasoby nie zmieniły się od zatwierdzenia.`)) void mutate(`/${entry.id}/undo`, {}); }}>Cofnij ostatni awans</button>}</div>)}</div></details>}
  </section>;
}
