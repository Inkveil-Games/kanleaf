import { type FormEvent, useState } from 'react';
import { Wordmark } from '../../components/ui/Wordmark';
import { ApiError, apiRequest } from '../../lib/api/client';
import type { AuthResponse } from '../../lib/api/types';

type AuthMode = 'login' | 'register';

interface AuthScreenProps {
  serverUrl: string;
  onAuthenticated: (response: AuthResponse) => void;
  onChangeServer: () => void;
}

export function AuthScreen({
  serverUrl,
  onAuthenticated,
  onChangeServer,
}: AuthScreenProps) {
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await apiRequest<AuthResponse>(
        serverUrl,
        `/api/auth/${mode === 'login' ? 'login' : 'register'}`,
        {
          method: 'POST',
          body: JSON.stringify({ email, password }),
        },
      );
      onAuthenticated(response);
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : 'Kanleaf could not reach the configured server',
      );
    } finally {
      setSubmitting(false);
    }
  }

  function changeMode(nextMode: AuthMode) {
    setMode(nextMode);
    setError(null);
  }

  return (
    <main className="onboarding">
      <section className="onboarding-intro">
        <Wordmark />
        <div>
          <p className="eyebrow">Connected</p>
          <h1>Pick up where your documents left off.</h1>
          <p className="server-caption">{serverUrl}</p>
        </div>
      </section>

      <section className="onboarding-form-pane" aria-labelledby="auth-title">
        <form className="auth-form" onSubmit={authenticate}>
          <div className="mode-switch" aria-label="Authentication mode">
            <button
              type="button"
              aria-pressed={mode === 'login'}
              onClick={() => changeMode('login')}
            >
              Sign in
            </button>
            <button
              type="button"
              aria-pressed={mode === 'register'}
              onClick={() => changeMode('register')}
            >
              New account
            </button>
          </div>

          <div className="form-heading">
            <h2 id="auth-title">
              {mode === 'login' ? 'Sign in to Kanleaf' : 'Create your account'}
            </h2>
            <p>
              {mode === 'login'
                ? 'Use the account stored on this server.'
                : 'A personal workspace will be created automatically.'}
            </p>
          </div>

          <label className="field">
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              autoCapitalize="none"
              required
            />
          </label>

          <label className="field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={
                mode === 'login' ? 'current-password' : 'new-password'
              }
              minLength={10}
              required
            />
            {mode === 'register' ? (
              <small>Use at least 10 characters.</small>
            ) : null}
          </label>

          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}

          <button
            className="primary-button"
            type="submit"
            disabled={submitting}
          >
            {submitting
              ? mode === 'login'
                ? 'Signing in…'
                : 'Creating account…'
              : mode === 'login'
                ? 'Sign in'
                : 'Register'}
          </button>

          <button
            className="text-button"
            type="button"
            onClick={onChangeServer}
          >
            Change server
          </button>
        </form>
      </section>
    </main>
  );
}
