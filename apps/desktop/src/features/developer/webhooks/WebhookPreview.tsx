import { useState } from 'react';
import { Copy } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { FormField } from '../../../components/ui/FormField';
import { Select } from '../../../components/ui/Select';
import { errorMessage } from '../../settings/utils';
import type { WebhookCatalog, WebhookEventType } from './types';

export function WebhookPreview({
  catalog,
  selected,
}: {
  catalog: WebhookCatalog;
  selected: WebhookEventType[];
}) {
  const [choice, setChoice] = useState<WebhookEventType | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const event = choice && selected.includes(choice) ? choice : selected[0];
  const json = event ? JSON.stringify(catalog.examples[event], null, 2) : '';
  async function copy() {
    try {
      await navigator.clipboard.writeText(json);
      setMessage('JSON copied');
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }
  return (
    <section
      className="settings-section webhook-preview"
      aria-label="Payload preview"
    >
      <h2>Payload preview</h2>
      <p>
        Example request body. Task, comment, actor, and delivery data are
        representative; no event is sent.
      </p>
      {event ? (
        <>
          <FormField label="Preview event">
            <Select
              ariaLabel="Preview event"
              value={event}
              options={selected.map((value) => ({ value, label: value }))}
              onValueChange={(value) => {
                const next = selected.find((type) => type === value);
                if (next) setChoice(next);
              }}
            />
          </FormField>
          <pre tabIndex={0} aria-label="JSON request body">
            <code>
              {json
                .split(
                  /("(?:\\.|[^"\\])*"(?:\s*:)?|\b(?:true|false|null)\b|\b\d+\b)/g,
                )
                .map((token, index) => (
                  <span
                    key={index}
                    className={
                      token.endsWith(':')
                        ? 'webhook-json-key'
                        : token.startsWith('"')
                          ? 'webhook-json-string'
                          : /^(true|false|null|\d+)$/.test(token)
                            ? 'webhook-json-value'
                            : undefined
                    }
                  >
                    {token}
                  </span>
                ))}
            </code>
          </pre>
          <Button size="sm" onClick={() => void copy()}>
            <Copy aria-hidden="true" size={14} /> Copy JSON
          </Button>
          {message ? <p role="status">{message}</p> : null}
          {error ? <p role="alert">{error}</p> : null}
          <details className="webhook-request-headers">
            <summary>Request headers</summary>
            <pre tabIndex={0} aria-label="Example request headers">
              <code>{`Content-Type: application/json\nX-Kanleaf-Event: ${event}\nX-Kanleaf-Delivery: <generated per delivery>\nX-Kanleaf-Timestamp: <delivery timestamp>\nX-Kanleaf-Signature: v1=<HMAC signature>`}</code>
            </pre>
            <p>
              The signature is calculated at delivery time from the exact body,
              timestamp, and signing secret.
            </p>
          </details>
        </>
      ) : (
        <p>Select at least one event to preview its request.</p>
      )}
    </section>
  );
}
