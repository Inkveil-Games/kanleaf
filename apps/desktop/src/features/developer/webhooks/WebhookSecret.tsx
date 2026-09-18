import { useState } from 'react';
import { Copy } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { errorMessage } from '../../settings/utils';

export function WebhookSecret({ secret }: { secret: string }) {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function copy() {
    try {
      await navigator.clipboard.writeText(secret);
      setMessage('Secret copied');
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }
  return (
    <section
      className="settings-section webhook-secret"
      aria-label="Signing secret"
    >
      <h2>Signing secret</h2>
      <p>Copy this secret now. For security, it won’t be shown again.</p>
      <code>{secret}</code>
      <Button size="sm" onClick={() => void copy()}>
        <Copy size={14} aria-hidden="true" /> Copy secret
      </Button>
      {message ? <p role="status">{message}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
