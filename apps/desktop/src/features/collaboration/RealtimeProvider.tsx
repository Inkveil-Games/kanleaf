import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { notifyUnauthorizedSession } from '../../lib/api/client';
import {
  parseRealtimeMessage,
  realtimeAuthenticationMessage,
  realtimeProtocolVersion,
  realtimeUrl,
  type RealtimeEvent,
} from './realtime';
import {
  RealtimeWorkspaceContext,
  type SetRealtimeWorkspace,
} from './realtimeWorkspace';

const reconnectBaseDelayMs = 500;
const reconnectMaximumDelayMs = 30_000;
const stableConnectionMs = 5_000;

export function RealtimeProvider({
  serverUrl,
  token,
  children,
}: {
  serverUrl: string;
  token: string;
  children: ReactNode;
}) {
  const queryClient = useQueryClient();
  const desiredWorkspaceRef = useRef<string | null>(null);
  const workspaceOwnerRef = useRef<symbol | null>(null);
  const sendWorkspaceRef = useRef<(workspaceId: string | null) => void>(
    () => {},
  );
  const ensureConnectedRef = useRef<() => void>(() => {});

  const setWorkspace = useCallback<SetRealtimeWorkspace>((workspaceId) => {
    const owner = Symbol('realtime-workspace');
    workspaceOwnerRef.current = owner;
    desiredWorkspaceRef.current = workspaceId;
    if (workspaceId) ensureConnectedRef.current();
    sendWorkspaceRef.current(workspaceId);
    return () => {
      if (workspaceOwnerRef.current !== owner) return;
      workspaceOwnerRef.current = null;
      desiredWorkspaceRef.current = null;
      sendWorkspaceRef.current(null);
    };
  }, []);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let stopped = false;
    let authenticated = false;
    let reconnectAttempt = 0;
    let reconnectTimer: number | null = null;
    let stableTimer: number | null = null;

    const sendWorkspace = (workspaceId: string | null) => {
      if (!authenticated || socket?.readyState !== WebSocket.OPEN) return;
      socket.send(
        JSON.stringify(
          workspaceId
            ? {
                version: realtimeProtocolVersion,
                type: 'subscribe',
                workspace_id: workspaceId,
              }
            : { version: realtimeProtocolVersion, type: 'unsubscribe' },
        ),
      );
    };

    const reconcileWorkspace = (workspaceId: string) => {
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ['task-feed', workspaceId] }),
        queryClient.invalidateQueries({
          queryKey: ['comment-revisions', workspaceId],
        }),
        queryClient.invalidateQueries({
          queryKey: ['notifications', serverUrl, token],
          exact: true,
        }),
      ]);
    };

    const handleEvent = (event: RealtimeEvent) => {
      if (event.workspace_id !== desiredWorkspaceRef.current) return;
      void queryClient.invalidateQueries({
        queryKey: ['task-feed', event.workspace_id, event.task_id],
        exact: true,
      });
      void queryClient.invalidateQueries({
        queryKey: ['notifications', serverUrl, token],
        exact: true,
      });
      if (
        event.entity_id &&
        (event.type === 'task.comment.edited' ||
          event.type === 'task.comment.deleted')
      ) {
        void queryClient.invalidateQueries({
          queryKey: [
            'comment-revisions',
            event.workspace_id,
            event.task_id,
            event.entity_id,
          ],
          exact: true,
        });
      }
    };

    const scheduleReconnect = () => {
      if (stopped || !desiredWorkspaceRef.current || reconnectTimer !== null) {
        return;
      }
      const exponentialDelay = Math.min(
        reconnectMaximumDelayMs,
        reconnectBaseDelayMs * 2 ** reconnectAttempt,
      );
      reconnectAttempt += 1;
      const jitteredDelay = exponentialDelay * (0.8 + Math.random() * 0.4);
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, jitteredDelay);
    };

    function connect() {
      if (
        stopped ||
        !desiredWorkspaceRef.current ||
        socket?.readyState === WebSocket.OPEN ||
        socket?.readyState === WebSocket.CONNECTING
      ) {
        return;
      }
      authenticated = false;
      socket = new WebSocket(realtimeUrl(serverUrl));
      socket.addEventListener('open', () => {
        if (stopped) return;
        socket?.send(realtimeAuthenticationMessage(token));
      });
      socket.addEventListener('message', (event) => {
        if (stopped) return;
        const message = parseRealtimeMessage(event.data);
        if (!message) return;
        if (message.type === 'authenticated') {
          authenticated = true;
          if (stableTimer !== null) window.clearTimeout(stableTimer);
          stableTimer = window.setTimeout(() => {
            reconnectAttempt = 0;
            stableTimer = null;
          }, stableConnectionMs);
          sendWorkspace(desiredWorkspaceRef.current);
          return;
        }
        if (message.type === 'subscribed') {
          if (message.workspace_id === desiredWorkspaceRef.current) {
            reconcileWorkspace(message.workspace_id);
          }
          return;
        }
        if (message.type === 'sync_required') {
          if (message.workspace_id === desiredWorkspaceRef.current) {
            reconcileWorkspace(message.workspace_id);
          }
          return;
        }
        if (message.type === 'error') {
          if (message.code === 'unauthorized') {
            stopped = true;
            notifyUnauthorizedSession(token);
            socket?.close();
          }
          return;
        }
        handleEvent(message);
      });
      socket.addEventListener('close', () => {
        if (stopped) return;
        authenticated = false;
        socket = null;
        if (stableTimer !== null) {
          window.clearTimeout(stableTimer);
          stableTimer = null;
        }
        scheduleReconnect();
      });
      socket.addEventListener('error', () => {
        if (!stopped) socket?.close();
      });
    }

    sendWorkspaceRef.current = sendWorkspace;
    ensureConnectedRef.current = connect;
    if (desiredWorkspaceRef.current) connect();

    return () => {
      stopped = true;
      authenticated = false;
      sendWorkspaceRef.current = () => {};
      ensureConnectedRef.current = () => {};
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      if (stableTimer !== null) window.clearTimeout(stableTimer);
      socket?.close(1000, 'Realtime session ended');
      socket = null;
    };
  }, [queryClient, serverUrl, token]);

  return (
    <RealtimeWorkspaceContext.Provider value={setWorkspace}>
      {children}
    </RealtimeWorkspaceContext.Provider>
  );
}
