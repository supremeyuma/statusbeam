'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { api, apiBaseUrl, setAccessToken } from '@/lib/client';
import styles from './login.module.css';

type Mode = 'login' | 'register';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const result =
        mode === 'login'
          ? await api.POST('/v1/auth/login', { body: { email, password } })
          : await api.POST('/v1/auth/register', { body: { email, password } });

      if (!result.data) {
        const body = (await result.response.json().catch(() => null)) as {
          message?: string | string[];
        } | null;
        const detail = Array.isArray(body?.message) ? body.message.join(', ') : body?.message;
        setError(detail ?? `Request failed (${result.response.status})`);
        return;
      }

      setAccessToken(result.data.accessToken);
      router.push('/dashboard');
    } catch {
      setError(`Could not reach the API at ${apiBaseUrl}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <p className={styles.eyebrow}>StatusBeam</p>
        <h1 className={styles.title}>{mode === 'login' ? 'Sign in' : 'Create an account'}</h1>
        <p className={styles.hint}>
          Dashboard access uses a 15-minute JWT and a rotating refresh cookie.
        </p>

        <div className={styles.tabs}>
          <button
            type="button"
            className={mode === 'login' ? styles.tabActive : styles.tab}
            onClick={() => setMode('login')}
          >
            Sign in
          </button>
          <button
            type="button"
            className={mode === 'register' ? styles.tabActive : styles.tab}
            onClick={() => setMode('register')}
          >
            Register
          </button>
        </div>

        <form onSubmit={(event) => void submit(event)} className={styles.form}>
          <label className={styles.label}>
            Email
            <input
              className={styles.input}
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label className={styles.label}>
            Password
            <input
              className={styles.input}
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              minLength={mode === 'register' ? 12 : 1}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>

          {error ? <p className={styles.error}>{error}</p> : null}

          <button className={styles.submit} type="submit" disabled={busy}>
            {busy ? 'Working…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>
      </div>
    </main>
  );
}
