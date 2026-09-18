import type { WebhookDelivery } from './types';
import { deliverySummary } from './deliverySummary';
export function WebhookDeliveries({
  deliveries,
}: {
  deliveries: WebhookDelivery[];
}) {
  return (
    <section
      className="settings-section webhook-deliveries"
      aria-label="Recent deliveries"
    >
      <h2>Recent deliveries</h2>
      {!deliveries.length ? (
        <p>No deliveries yet. Send a test webhook to check your endpoint.</p>
      ) : (
        <ol className="webhook-delivery-list">
          {deliveries.map((delivery) => (
            <li key={delivery.id}>
              <div>
                <strong>{delivery.event_type}</strong>
                {delivery.is_test ? <small>Test</small> : null}
                <span
                  className={
                    delivery.status === 'succeeded'
                      ? 'settings-success'
                      : delivery.status === 'failed'
                        ? 'settings-error'
                        : 'webhook-muted'
                  }
                >
                  {deliverySummary(delivery)}
                </span>
              </div>
              <div>
                <small>
                  {delivery.attempt_count}{' '}
                  {delivery.attempt_count === 1 ? 'attempt' : 'attempts'}
                </small>
                <time dateTime={delivery.created_at}>
                  {new Date(delivery.created_at).toLocaleString()}
                </time>
              </div>
              {delivery.last_error ? <p>{delivery.last_error}</p> : null}
              {delivery.status === 'pending' && delivery.attempt_count > 0 ? (
                <small>
                  Next attempt:{' '}
                  {new Date(delivery.next_attempt_at).toLocaleString()}
                </small>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
