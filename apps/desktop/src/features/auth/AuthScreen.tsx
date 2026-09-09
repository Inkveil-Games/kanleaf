import { Wordmark } from '../../components/ui/Wordmark';
import type { AuthResponse } from '../../lib/api/types';
import { AuthForm } from './AuthForm';

interface AuthScreenProps {
  serverUrl: string;
  onAuthenticated: (response: AuthResponse) => void | Promise<void>;
  onForgotPassword?: () => void;
}

export function AuthScreen({
  serverUrl,
  onAuthenticated,
  onForgotPassword,
}: AuthScreenProps) {
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
        <AuthForm
          serverUrl={serverUrl}
          onAuthenticated={onAuthenticated}
          onForgotPassword={onForgotPassword}
        />
      </section>
    </main>
  );
}
