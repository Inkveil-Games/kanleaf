export type WebhookEventType =
  | 'task.created'
  | 'task.updated'
  | 'task.deleted'
  | 'comment.created'
  | 'comment.updated'
  | 'comment.deleted';
export interface WebhookInput {
  name: string;
  endpoint_url: string;
  project_scope: 'all' | 'selected';
  project_ids: string[];
  event_types: WebhookEventType[];
  enabled: boolean;
}
export interface Webhook {
  id: string;
  workspace_id: string;
  name: string;
  endpoint_url: string;
  enabled: boolean;
  project_scope: 'all' | 'selected';
  projects: { id: string; name: string; identifier: string }[];
  event_types: WebhookEventType[];
  created_at: string;
  updated_at: string;
  secret_regenerated_at: string;
}
export interface WebhookDelivery {
  id: string;
  event_id: string;
  event_type: WebhookEventType | 'webhook.test';
  is_test: boolean;
  status: 'pending' | 'succeeded' | 'failed' | 'canceled';
  attempt_count: number;
  http_status: number | null;
  duration_ms: number | null;
  last_error: string | null;
  next_attempt_at: string;
  created_at: string;
  delivered_at: string | null;
}
export interface WebhookCatalog {
  event_types: WebhookEventType[];
  // Examples are serialized by the same backend schema as actual deliveries.
  examples: Record<WebhookEventType, Record<string, unknown>>;
  allow_http: boolean;
}
