import { type FormEvent, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { Input } from '../../components/ui/Input';
import { PasswordField } from '../../components/ui/PasswordField';
import { ApiError } from '../../lib/api/client';
import type { AuthResponse } from '../../lib/api/types';
import { authenticate as authenticateRequest } from './api';

type AuthMode = 'login' | 'register';

interface AuthFormProps {
  serverUrl: string;
  onAuthenticated: (response: AuthResponse) => void | Promise<void>;
  initialMode?: AuthMode;
  onForgotPassword?: () => void;
}

export function AuthForm({
  serverUrl,
  onAuthenticated,
  initialMode = 'login',
  onForgotPassword,
}: AuthFormProps) {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [confirmationError, setConfirmationError] = useState<string | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
      const response = await authenticateRequest(
        serverUrl,
        mode,
        email,
        password,
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

      <FormField label="Email" required>
        <Input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="email"
          autoCapitalize="none"
          required
          disabled={submitting}
        />
      </FormField>

      <FormField
        label="Password"
        required
        hint={mode === 'register' ? 'Use at least 10 characters.' : undefined}
        action={
          mode === 'login' && onForgotPassword ? (
            <Button
              variant="text"
              size="sm"
              disabled={submitting}
              onClick={onForgotPassword}
            >
              Forgot password?
            </Button>
          ) : undefined
        }
      >
        <PasswordField
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            setConfirmationError(null);
          }}
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          minLength={10}
          required
          disabled={submitting}
        />
      </FormField>

      {mode === 'register' ? (
        <FormField label="Confirm password" required error={confirmationError}>
          <PasswordField
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
          />
        </FormField>
      ) : null}

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}

      <Button
        variant="primary"
        type="submit"
        loading={submitting}
        loadingLabel={mode === 'login' ? 'Signing in' : 'Creating account'}
      >
        {mode === 'login' ? 'Sign in' : 'Register'}
      </Button>
    </form>
  );
}
