import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, type User } from '../../api';
import { Card } from '../../components/ui/Card';
import { CharacterFields } from './CharacterFields';

export function CreateCharacterPage({ user, onBack }: { user: User; onBack: () => void }) {
  const isAdmin = user.role === 'admin';
  const [players, setPlayers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    heading.current?.focus();
    if (!isAdmin) { setLoading(false); return; }
    Promise.all([api<{ players: User[] }>('/admin/players'), api<{ players: User[] }>('/admin/gms')])
      .then(([p, g]) => setPlayers([...p.players, ...g.players]))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [isAdmin]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const values = Object.fromEntries(new FormData(event.currentTarget));
    setPending(true); setError('');
    try {
      await api(isAdmin ? '/admin/characters' : '/characters', { ...values, userId: isAdmin ? Number(values.userId) : user.id, level: user.role === 'player' ? 1 : Number(values.level) });
      setCreated(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się utworzyć postaci. Spróbuj ponownie.');
    } finally { setPending(false); }
  }

  return <div className="character-create-page">
    <button type="button" className="text-button" disabled={pending} onClick={onBack}>{isAdmin ? '← Wróć do administracji' : '← Moje postacie'}</button>
    <header className="page-heading">
      <p className="eyebrow">{isAdmin ? 'ADMINISTRACJA / POSTACIE' : 'MOJE POSTACIE'}</p>
      <h1 ref={heading} tabIndex={-1}>Nowa postać</h1>
      <p>{isAdmin ? 'Wybierz właściciela i określ podstawy jego postaci.' : user.role === 'player' ? 'Stwórz własnego bohatera na poziomie 1.' : 'Stwórz własnego bohatera na wybranym poziomie 1–20.'}</p>
    </header>
    {error && <p className="form-error" role="alert">{error}</p>}
    {created ? <Card title="Postać utworzona"><p role="status">Bohater został zapisany i jest już widoczny na koncie właściciela.</p><button className="primary-button" onClick={onBack}>{isAdmin ? 'Wróć do administracji' : 'Przejdź do moich postaci'}</button></Card>
      : loading ? <p role="status">Wczytywanie graczy…</p>
      : isAdmin && !players.length ? <Card title={error ? 'Lista kont niedostępna' : 'Najpierw dodaj konto'}><p>{error ? 'Wróć do administracji i spróbuj ponownie otworzyć formularz.' : 'Postać musi być przypisana do konta gracza lub GM. Utwórz je w panelu administracji.'}</p><button className="primary-button" onClick={onBack}>Przejdź do administracji</button></Card>
      : <Card title="Podstawy bohatera"><form className="stack-form character-create-form" onSubmit={submit}>
        <fieldset disabled={pending}><CharacterFields players={players} owner={isAdmin ? undefined : user} firstLevelOnly={user.role === 'player'} /></fieldset>
        <div className="admin-actions"><button className="primary-button" disabled={pending}>{pending ? 'Zapisywanie…' : 'Utwórz postać'}</button><button type="button" className="text-button" disabled={pending} onClick={onBack}>Anuluj</button></div>
      </form></Card>}
  </div>;
}
