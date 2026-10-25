import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, type User } from '../../api';
import { Card } from '../../components/ui/Card';
import { CharacterFields } from '../characters/CharacterFields';

export function CreateCharacterPage({ onBack }: { onBack: () => void }) {
  const [players, setPlayers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    heading.current?.focus();
    api<{ players: User[] }>('/admin/players')
      .then(data => setPlayers(data.players))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const values = Object.fromEntries(new FormData(event.currentTarget));
    setPending(true); setError('');
    try {
      await api('/admin/characters', { ...values, userId: Number(values.userId), level: Number(values.level) });
      setCreated(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się utworzyć postaci. Spróbuj ponownie.');
    } finally { setPending(false); }
  }

  return <div className="character-create-page">
    <button type="button" className="text-button" disabled={pending} onClick={onBack}>← Wróć do administracji</button>
    <header className="page-heading">
      <p className="eyebrow">ADMINISTRACJA / POSTACIE</p>
      <h1 ref={heading} tabIndex={-1}>Nowa postać</h1>
      <p>Każda przygoda zaczyna się od bohatera. Wybierz gracza i określ podstawy jego postaci.</p>
    </header>
    {error && <p className="form-error" role="alert">{error}</p>}
    {created ? <Card title="Postać utworzona"><p role="status">Bohater został zapisany i jest już widoczny na koncie gracza.</p><button className="primary-button" onClick={onBack}>Przejdź do listy postaci</button></Card>
      : loading ? <p role="status">Wczytywanie graczy…</p>
      : !players.length ? <Card title={error ? 'Lista graczy niedostępna' : 'Najpierw dodaj gracza'}><p>{error ? 'Wróć do administracji i spróbuj ponownie otworzyć formularz.' : 'Postać musi być przypisana do konta gracza. Utwórz je w panelu administracji.'}</p><button className="primary-button" onClick={onBack}>Przejdź do administracji</button></Card>
      : <Card title="Podstawy bohatera"><form className="stack-form character-create-form" onSubmit={submit}>
        <fieldset disabled={pending}><CharacterFields players={players} /></fieldset>
        <div className="admin-actions"><button className="primary-button" disabled={pending}>{pending ? 'Zapisywanie…' : 'Utwórz postać'}</button><button type="button" className="text-button" disabled={pending} onClick={onBack}>Anuluj</button></div>
      </form></Card>}
  </div>;
}
