import { describe, expect, it } from 'vitest';
import {
  parseRealtimeMessage,
  realtimeAuthenticationMessage,
  realtimeUrl,
} from './realtime';

describe('realtime protocol', () => {
  it('builds ws and wss URLs without dropping a deployment base path', () => {
    expect(realtimeUrl('http://127.0.0.1:3000')).toBe(
      'ws://127.0.0.1:3000/api/realtime',
    );
    expect(realtimeUrl('https://kanleaf.example.com/base')).toBe(
      'wss://kanleaf.example.com/base/api/realtime',
    );
  });

  it('keeps the bearer token in the authentication message instead of the URL', () => {
    const token = 'private-session-token';
    expect(realtimeUrl('https://kanleaf.example.com')).not.toContain(token);
    expect(JSON.parse(realtimeAuthenticationMessage(token))).toEqual({
      version: 1,
      type: 'authenticate',
      token,
    });
  });

  it('accepts the versioned event contract and ignores malformed or unknown messages', () => {
    expect(
      parseRealtimeMessage(
        JSON.stringify({
          version: 1,
          id: 'event-1',
          type: 'task.comment.created',
          workspace_id: 'workspace-1',
          task_id: 'task-1',
          entity_id: 'comment-1',
          occurred_at: '2026-09-12T12:00:00Z',
        }),
      ),
    ).toMatchObject({ type: 'task.comment.created', entity_id: 'comment-1' });
    expect(parseRealtimeMessage('{broken')).toBeNull();
    expect(
      parseRealtimeMessage(
        JSON.stringify({ version: 1, type: 'future.event' }),
      ),
    ).toBeNull();
    expect(
      parseRealtimeMessage(
        JSON.stringify({
          version: 2,
          id: 'event-2',
          type: 'task.comment.created',
          workspace_id: 'workspace-1',
          task_id: 'task-1',
          occurred_at: '2026-09-12T12:00:00Z',
        }),
      ),
    ).toBeNull();
  });
});
