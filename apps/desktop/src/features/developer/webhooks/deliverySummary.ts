import type { WebhookDelivery } from './types';

export function deliverySummary(delivery: WebhookDelivery) {
  const labels = {
    succeeded: 'Succeeded',
    pending: 'Pending',
    canceled: 'Canceled',
    failed: 'Failed',
  };
  return `${labels[delivery.status]}${delivery.http_status ? ` · HTTP ${delivery.http_status}` : ''}${delivery.duration_ms !== null ? ` · ${delivery.duration_ms} ms` : ''}`;
}
