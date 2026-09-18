import { apiRequest } from '../../../lib/api/client';
import type { ApiContext } from '../../workspace/api';
import type {
  Webhook,
  WebhookCatalog,
  WebhookDelivery,
  WebhookInput,
} from './types';

const collection = (workspaceId: string) =>
  `/api/workspaces/${encodeURIComponent(workspaceId)}/webhooks`;
const resource = (workspaceId: string, id: string) =>
  `${collection(workspaceId)}/${encodeURIComponent(id)}`;
function request<T>(
  context: ApiContext,
  path: string,
  method = 'GET',
  body?: unknown,
) {
  return apiRequest<T>(context.serverUrl, path, {
    token: context.token,
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
export const webhookKey = (context: ApiContext, workspaceId: string) =>
  ['webhooks', context.serverUrl, context.token, workspaceId] as const;
export const listWebhooks = (context: ApiContext, workspaceId: string) =>
  request<Webhook[]>(context, collection(workspaceId));
export const getWebhook = (
  context: ApiContext,
  workspaceId: string,
  id: string,
) => request<Webhook>(context, resource(workspaceId, id));
export const createWebhook = (
  context: ApiContext,
  workspaceId: string,
  input: WebhookInput,
) =>
  request<{ webhook: Webhook; signing_secret: string }>(
    context,
    collection(workspaceId),
    'POST',
    input,
  );
export const updateWebhook = (
  context: ApiContext,
  workspaceId: string,
  id: string,
  input: WebhookInput,
) => request<Webhook>(context, resource(workspaceId, id), 'PATCH', input);
export const setWebhookEnabled = (
  context: ApiContext,
  workspaceId: string,
  id: string,
  enabled: boolean,
) =>
  request<Webhook>(context, `${resource(workspaceId, id)}/enabled`, 'PATCH', {
    enabled,
  });
export const deleteWebhook = (
  context: ApiContext,
  workspaceId: string,
  id: string,
) => request<void>(context, resource(workspaceId, id), 'DELETE');
export const regenerateWebhookSecret = (
  context: ApiContext,
  workspaceId: string,
  id: string,
) =>
  request<{ signing_secret: string }>(
    context,
    `${resource(workspaceId, id)}/secret`,
    'POST',
  );
export const sendTestWebhook = (
  context: ApiContext,
  workspaceId: string,
  id: string,
) =>
  request<WebhookDelivery>(
    context,
    `${resource(workspaceId, id)}/test`,
    'POST',
  );
export const listWebhookDeliveries = (
  context: ApiContext,
  workspaceId: string,
  id: string,
) =>
  request<WebhookDelivery[]>(
    context,
    `${resource(workspaceId, id)}/deliveries`,
  );
export const getWebhookDelivery = (
  context: ApiContext,
  workspaceId: string,
  id: string,
  deliveryId: string,
) =>
  request<WebhookDelivery>(
    context,
    `${resource(workspaceId, id)}/deliveries/${encodeURIComponent(deliveryId)}`,
  );
export const getWebhookCatalog = (
  context: ApiContext,
  workspaceId: string,
  projectId?: string,
) =>
  request<WebhookCatalog>(
    context,
    `/api/workspaces/${encodeURIComponent(workspaceId)}/webhook-catalog${projectId ? `?project_id=${encodeURIComponent(projectId)}` : ''}`,
  );
