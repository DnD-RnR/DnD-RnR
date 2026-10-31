import { useState } from 'react';
import { api } from '../../api';

export function SpellRestControls({ gameId }: { gameId: number }) {
  const [pending, setPending] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
  async function rest(kind: 'long' | 'short') {
    if (!window.confirm(kind === 'long' ? 'Potwierdzasz, że postacie w sesji ukończyły prawidłowy długi odpoczynek (co najmniej 8 godzin, nie częściej niż raz na 24 godziny czasu gry)? Odnowić ich miejsca na czary i Mystic Arcanum?' : 'Potwierdzasz ukończenie prawidłowego krótkiego odpoczynku (co najmniej godzina czasu gry)? Odnowić Pact Magic postaci w sesji?')) return;
    setPending(true); setError(''); setMessage('');
    try { const data = await api<{ restored: number }>(`/games/${gameId}/spell-rest`, { rest: kind }); setMessage(`Odnowiono zasoby magiczne ${data.restored} postaci.`); }
    catch (e) { setError(e instanceof Error ? e.message : 'Nie udało się odnowić magii.'); }
    finally { setPending(false); }
  }
  return <details><summary>Odnowienie magii po odpoczynku</summary><p>GM zatwierdza spełnienie warunków odpoczynku w czasie gry. Krótki odpoczynek odnawia wyłącznie Pact Magic; długi także zwykłe miejsca i Mystic Arcanum.</p><div className="battle-toolbar"><button className="text-button" disabled={pending} onClick={() => void rest('short')}>Krótki odpoczynek — Pact Magic</button><button className="text-button" disabled={pending} onClick={() => void rest('long')}>Długi odpoczynek — odnów magię</button></div>{message && <p role="status">{message}</p>}{error && <p role="alert" className="form-error">{error}</p>}</details>;
}
