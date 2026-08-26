import { type FormEvent, useState } from 'react';
import { Wordmark } from '../../components/ui/Wordmark';
import { DEFAULT_SERVER_URL, verifyServerUrl } from './storage';

interface ConnectionScreenProps {
  initialUrl?: string;
  onConnected: (serverUrl: string) => void;
}

export function ConnectionScreen({
  initialUrl = DEFAULT_SERVER_URL,
  onConnected,
}: ConnectionScreenProps) {
  const [serverUrl, setServerUrl] = useState(initialUrl);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setConnecting(true);
    setError(null);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8_000);

    try {
      onConnected(await verifyServerUrl(serverUrl, controller.signal));
    } catch (cause) {
      setError(
        cause instanceof DOMException && cause.name === 'AbortError'
          ? 'The server did not respond in time'
          : cause instanceof Error
            ? cause.message
            : 'Kanleaf could not reach this server',
      );
    } finally {
      window.clearTimeout(timeout);
      setConnecting(false);
    }
  }

  return (
    <main className="onboarding">
      <section className="onboarding-intro">
        <Wordmark />
        <div>
          <p className="eyebrow">Your work stays yours</p>
          <h1>Structured work, durable notes.</h1>
          <p>Connect this desktop client to the Kanleaf server you control.</p>
        </div>
      </section>

      <section
        className="onboarding-form-pane"
        aria-labelledby="connection-title"
      >
        <form className="auth-form" onSubmit={connect}>
          <div className="form-heading">
            <p className="step-label">Server setup</p>
            <h2 id="connection-title">Connect to your server</h2>
            <p>
              Kanleaf will verify the address before storing it on this device.
            </p>
          </div>

          <label className="field">
            <span>Server URL</span>
            <input
              type="url"
              value={serverUrl}
              onChange={(event) => setServerUrl(event.target.value)}
              placeholder={DEFAULT_SERVER_URL}
              autoComplete="url"
              autoCapitalize="none"
              spellCheck={false}
              required
            />
          </label>

          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}

          <button
            className="primary-button"
            type="submit"
            disabled={connecting}
          >
            {connecting ? 'Checking server…' : 'Connect'}
          </button>
        </form>
      </section>
    </main>
  );
}
