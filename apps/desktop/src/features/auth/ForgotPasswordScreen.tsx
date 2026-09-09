import { type FormEvent, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { routePaths } from '../../app/routing/routePaths';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { Input } from '../../components/ui/Input';
import { Wordmark } from '../../components/ui/Wordmark';
import { requestPasswordReset } from './api';
import { invitationReturnToFromHash } from './passwordResetReturnTo';

const GENERIC_CONFIRMATION =
  'If an account exists for this email, a password reset link has been sent.';

export function ForgotPasswordScreen({ serverUrl }: { serverUrl: string }) {
  const location = useLocation();
  const navigate = useNavigate();
  const returnTo = invitationReturnToFromHash(location.hash);
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await requestPasswordReset(serverUrl, email, returnTo);
      setSent(true);
    } catch {
      setError('Kanleaf could not request a password reset. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  function backToSignIn() {
    navigate(returnTo ?? routePaths.root());
  }

  return (
    <main className="status-page auth-flow-page">
      <Wordmark quiet />
      <section aria-labelledby="forgot-password-title">
        <div className="form-heading">
          <h1 id="forgot-password-title">Forgot your password?</h1>
          <p>
            Enter your account email and Kanleaf will send a secure reset link.
          </p>
        </div>
        {sent ? (
          <div className="auth-flow-feedback" aria-live="polite">
            <p>{GENERIC_CONFIRMATION}</p>
            <Button variant="text" onClick={backToSignIn}>
              Back to sign in
            </Button>
          </div>
        ) : (
          <form className="auth-form" onSubmit={(event) => void submit(event)}>
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
            {error ? (
              <p className="form-error" role="alert">
                {error}
              </p>
            ) : null}
            <Button
              variant="primary"
              type="submit"
              loading={submitting}
              loadingLabel="Sending reset link"
            >
              Send reset link
            </Button>
            <Button variant="text" disabled={submitting} onClick={backToSignIn}>
              Back to sign in
            </Button>
          </form>
        )}
      </section>
    </main>
  );
}
