import { useState, type FormEvent } from 'react';
import { api, type User } from '../../api';

export function LoginPage({ onLogin }: { onLogin: (user: User) => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true); setError('');
    try { onLogin((await api<{ user: User }>('/login', { username: form.get('username'), password: form.get('password') })).user); }
    catch (error) { setError(error instanceof Error ? error.message : 'Nie można połączyć się z serwerem.'); }
    finally { setPending(false); }
  }
  return <div className="login-shell">
    <section className="login-intro"><span className="brand">◈ DnD <span>RnR</span></span><p className="eyebrow">WASZA DRUŻYNA. WASZA HISTORIA.</p><h1>Przygoda czeka<br />po drugiej stronie.</h1><p>Wróć do swoich bohaterów i przygotuj się na kolejną sesję.</p><span className="login-dice" aria-hidden="true">◈</span></section>
    <main className="login-panel"><p className="eyebrow">WITAJ PRZY STOLE</p><h2>Zaloguj się</h2><p>Podaj dane otrzymane od administratora.</p>
      <form onSubmit={submit} className="stack-form">
        <label>Login<input name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} required maxLength={40} placeholder="Twój login" /></label>
        <label>Hasło<input name="password" type="password" autoComplete="current-password" required maxLength={128} placeholder="Twoje hasło" /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="primary-button" disabled={pending}>{pending ? 'Logowanie…' : 'Wejdź do drużyny →'}</button>
      </form><p className="login-help">Nie masz konta lub nie pamiętasz hasła?<br />Skontaktuj się z administratorem waszej gry.</p>
    </main>
  </div>;
}
