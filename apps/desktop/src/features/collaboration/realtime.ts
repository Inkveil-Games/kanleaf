export const realtimeProtocolVersion = 1;

export type RealtimeEventType =
  | 'task.comment.created'
  | 'task.comment.edited'
  | 'task.comment.deleted'
  | 'task.activity.changed';

export interface RealtimeEvent {
  version: 1;
  id: string;
  type: RealtimeEventType;
  workspace_id: string;
  task_id: string;
  entity_id?: string;
  occurred_at: string;
}

export type RealtimeServerMessage =
  | { version: 1; type: 'authenticated' }
  | { version: 1; type: 'subscribed'; workspace_id: string }
  | { version: 1; type: 'sync_required'; workspace_id: string }
  | {
      version: 1;
      type: 'error';
      code: 'unauthorized' | 'forbidden' | 'invalid_message';
    }
  | RealtimeEvent;

const eventTypes = new Set<RealtimeEventType>([
  'task.comment.created',
  'task.comment.edited',
  'task.comment.deleted',
  'task.activity.changed',
]);

export function realtimeUrl(serverUrl: string): string {
  const url = new URL(serverUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = `${url.pathname.replace(/\/$/, '')}/api/realtime`;
  url.search = '';
  url.hash = '';
  return url.toString();
}

export function realtimeAuthenticationMessage(token: string) {
  return JSON.stringify({
    version: realtimeProtocolVersion,
    type: 'authenticate',
    token,
  });
}

export function parseRealtimeMessage(
  data: unknown,
): RealtimeServerMessage | null {
  if (typeof data !== 'string') return null;
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return null;
  }
  if (!isRecord(value) || value.version !== realtimeProtocolVersion)
    return null;
  if (value.type === 'authenticated') return { version: 1, type: value.type };
  if (
    (value.type === 'subscribed' || value.type === 'sync_required') &&
    typeof value.workspace_id === 'string'
  ) {
    return {
      version: 1,
      type: value.type,
      workspace_id: value.workspace_id,
    };
  }
  if (
    value.type === 'error' &&
    (value.code === 'unauthorized' ||
      value.code === 'forbidden' ||
      value.code === 'invalid_message')
  ) {
    return { version: 1, type: value.type, code: value.code };
  }
  if (
    typeof value.type === 'string' &&
    eventTypes.has(value.type as RealtimeEventType) &&
    typeof value.id === 'string' &&
    typeof value.workspace_id === 'string' &&
    typeof value.task_id === 'string' &&
    typeof value.occurred_at === 'string' &&
    (value.entity_id === undefined || typeof value.entity_id === 'string')
  ) {
    return {
      version: 1,
      id: value.id,
      type: value.type as RealtimeEventType,
      workspace_id: value.workspace_id,
      task_id: value.task_id,
      occurred_at: value.occurred_at,
      ...(typeof value.entity_id === 'string'
        ? { entity_id: value.entity_id }
        : {}),
    };
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
