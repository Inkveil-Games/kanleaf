import { type FormEvent, useId, useState } from 'react';
import { PasswordField } from '../../components/ui/PasswordField';
import { ApiError, apiRequest } from '../../lib/api/client';
import type { AuthResponse } from '../../lib/api/types';

type AuthMode = 'login' | 'register';

interface AuthFormProps {
  serverUrl: string;
  onAuthenticated: (response: AuthResponse) => void | Promise<void>;
}

export function AuthForm({ serverUrl, onAuthenticated }: AuthFormProps) {
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [confirmationError, setConfirmationError] = useState<string | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const passwordId = useId();
  const passwordHintId = useId();
  const confirmationId = useId();
  const confirmationErrorId = useId();

  async function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mode === 'register' && password !== passwordConfirmation) {
      setError(null);
      setConfirmationError('Passwords do not match');
      return;
    }
    setSubmitting(true);
    setError(null);
    setConfirmationError(null);
    try {
      const response = await apiRequest<AuthResponse>(
        serverUrl,
        `/api/auth/${mode === 'login' ? 'login' : 'register'}`,
        {
          method: 'POST',
          body: JSON.stringify({ email, password }),
        },
      );
      await onAuthenticated(response);
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
    setConfirmationError(null);
    setPasswordConfirmation('');
  }

  return (
    <form className="auth-form" onSubmit={(event) => void authenticate(event)}>
      <div className="mode-switch" aria-label="Authentication mode">
        <button
          type="button"
          aria-pressed={mode === 'login'}
          disabled={submitting}
          onClick={() => changeMode('login')}
        >
          Sign in
        </button>
        <button
          type="button"
          aria-pressed={mode === 'register'}
          disabled={submitting}
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
            : 'Start with your account details, then create or join a Workspace.'}
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
          disabled={submitting}
        />
      </label>

      <div className="field">
        <label htmlFor={passwordId}>Password</label>
        <PasswordField
          id={passwordId}
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            setConfirmationError(null);
          }}
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          minLength={10}
          required
          disabled={submitting}
          aria-describedby={mode === 'register' ? passwordHintId : undefined}
        />
        {mode === 'register' ? (
          <small id={passwordHintId}>Use at least 10 characters.</small>
        ) : null}
      </div>

      {mode === 'register' ? (
        <div className="field">
          <label htmlFor={confirmationId}>Confirm password</label>
          <PasswordField
            id={confirmationId}
            visibilityLabel="password confirmation"
            value={passwordConfirmation}
            onChange={(event) => {
              setPasswordConfirmation(event.target.value);
              setConfirmationError(null);
            }}
            autoComplete="new-password"
            minLength={10}
            required
            disabled={submitting}
            aria-invalid={confirmationError ? true : undefined}
            aria-describedby={
              confirmationError ? confirmationErrorId : undefined
            }
          />
          {confirmationError ? (
            <small
              className="field-error"
              id={confirmationErrorId}
              role="alert"
            >
              {confirmationError}
            </small>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}

      <button className="primary-button" type="submit" disabled={submitting}>
        {submitting
          ? mode === 'login'
            ? 'Signing in…'
            : 'Creating account…'
          : mode === 'login'
            ? 'Sign in'
            : 'Register'}
      </button>
    </form>
  );
}
