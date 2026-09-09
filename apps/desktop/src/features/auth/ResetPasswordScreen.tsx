import { type FormEvent, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { routePaths } from '../../app/routing/routePaths';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { PasswordField } from '../../components/ui/PasswordField';
import { Wordmark } from '../../components/ui/Wordmark';
import { ApiError } from '../../lib/api/client';
import { resetPassword } from './api';
import { passwordResetRouteFromHash } from './passwordResetReturnTo';

const INVALID_LINK =
  'This reset link is invalid or has expired. Request a new link.';
const MAX_PASSWORD_BYTES = 1024;

export function ResetPasswordScreen({
  serverUrl,
  onPasswordReset,
}: {
  serverUrl: string;
  onPasswordReset?: () => Promise<void>;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const route = passwordResetRouteFromHash(location.hash);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [confirmationError, setConfirmationError] = useState<string | null>(
    null,
  );
  const [requestError, setRequestError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [updated, setUpdated] = useState(false);

  if (!route) {
    return (
      <PasswordResetStatus
        title="Reset link unavailable"
        description={INVALID_LINK}
        action={
          <Button
            variant="primary"
            onClick={() => navigate(routePaths.forgotPassword())}
          >
            Request a new link
          </Button>
        }
      />
    );
  }
  const resetRoute = route;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordError(null);
    setConfirmationError(null);
    setRequestError(null);
    if (password !== confirmation) {
      setConfirmationError('Passwords do not match');
      return;
    }
    if (Array.from(password).length < 10) {
      setPasswordError('Password must contain at least 10 characters');
      return;
    }
    if (new TextEncoder().encode(password).byteLength > MAX_PASSWORD_BYTES) {
      setPasswordError('Password is too long');
      return;
    }

    setSubmitting(true);
    try {
      await resetPassword(serverUrl, resetRoute.token, password);
      await onPasswordReset?.();
      setUpdated(true);
    } catch (cause) {
      setRequestError(
        cause instanceof ApiError && cause.status === 422
          ? INVALID_LINK
          : 'Kanleaf could not reset your password. Try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (updated) {
    return (
      <PasswordResetStatus
        title="Password updated"
        description="Your password has been changed successfully."
        action={
          <Button
            variant="primary"
            onClick={() => navigate(resetRoute.returnTo ?? routePaths.root())}
          >
            Back to sign in
          </Button>
        }
      />
    );
  }

  return (
    <main className="status-page auth-flow-page">
      <Wordmark quiet />
      <section aria-labelledby="reset-password-title">
        <form className="auth-form" onSubmit={(event) => void submit(event)}>
          <div className="form-heading">
            <h1 id="reset-password-title">Set a new password</h1>
            <p>
              Use at least 10 characters. All existing sessions will be signed
              out.
            </p>
          </div>
          <FormField label="New password" required error={passwordError}>
            <PasswordField
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setPasswordError(null);
                setConfirmationError(null);
                setRequestError(null);
              }}
              autoComplete="new-password"
              minLength={10}
              required
              disabled={submitting}
            />
          </FormField>
          <FormField
            label="Confirm password"
            required
            error={confirmationError}
          >
            <PasswordField
              visibilityLabel="password confirmation"
              value={confirmation}
              onChange={(event) => {
                setConfirmation(event.target.value);
                setConfirmationError(null);
                setRequestError(null);
              }}
              autoComplete="new-password"
              minLength={10}
              required
              disabled={submitting}
            />
          </FormField>
          {requestError ? (
            <p className="form-error" role="alert">
              {requestError}
            </p>
          ) : null}
          <Button
            variant="primary"
            type="submit"
            loading={submitting}
            loadingLabel="Resetting password"
          >
            Reset password
          </Button>
        </form>
      </section>
    </main>
  );
}

function PasswordResetStatus({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action: React.ReactNode;
}) {
  return (
    <main className="status-page auth-flow-page">
      <Wordmark quiet />
      <section className="auth-flow-feedback">
        <div className="form-heading">
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        {action}
      </section>
    </main>
  );
}
