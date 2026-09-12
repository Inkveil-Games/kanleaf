import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { StrictMode, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { subscribeToUnauthorizedRequests } from '../../lib/api/client';
import { RealtimeProvider } from './RealtimeProvider';
import { useRealtimeWorkspace } from './realtimeWorkspace';

const serverUrl = 'https://kanleaf.example.com/base';

describe('RealtimeProvider', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('refetches the affected Task feed so another client comment becomes visible', async () => {
    let feed = 'Initial activity';
    const query = vi.fn(async () => feed);
    renderRealtime(<Feed taskId="task-1" query={query} />);
    const socket = authenticateAndSubscribe();
    expect(await screen.findByText('Initial activity')).toBeInTheDocument();

    feed = 'Comment from another client';
    act(() => socket.receive(taskEvent('task.comment.created', 'task-1')));

    expect(
      await screen.findByText('Comment from another client'),
    ).toBeInTheDocument();
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('does not refetch the open Task for an event belonging to another Task', async () => {
    const query = vi.fn(async () => 'Current Task');
    renderRealtime(<Feed taskId="task-1" query={query} />);
    const socket = authenticateAndSubscribe();
    await screen.findByText('Current Task');

    await act(async () => {
      socket.receive(taskEvent('task.comment.created', 'task-2'));
      await Promise.resolve();
    });

    expect(query).toHaveBeenCalledTimes(1);
  });

  it('reconciles feeds and notifications after reconnecting', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const { queryClient } = renderRealtime(<div>Workspace</div>);
    const invalidations = vi.spyOn(queryClient, 'invalidateQueries');
    const first = authenticateAndSubscribe();
    invalidations.mockClear();

    act(() => first.serverClose());
    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });
    const second = FakeWebSocket.instances[1]!;
    act(() => second.open());
    expect(JSON.parse(second.sent[0]!)).toMatchObject({
      type: 'authenticate',
      token: 'session-token',
    });
    act(() => second.receive({ version: 1, type: 'authenticated' }));
    act(() =>
      second.receive({
        version: 1,
        type: 'subscribed',
        workspace_id: 'workspace-1',
      }),
    );

    expect(invalidations).toHaveBeenCalledWith({
      queryKey: ['notifications', serverUrl, 'session-token'],
      exact: true,
    });
    expect(invalidations).toHaveBeenCalledWith({
      queryKey: ['task-feed', 'workspace-1'],
    });
    expect(invalidations).toHaveBeenCalledWith({
      queryKey: ['comment-revisions', 'workspace-1'],
    });
  });

  it('changes Workspace subscriptions without opening another socket', async () => {
    const query = vi.fn(async () => 'Original Workspace');
    const { rerenderRealtime } = renderRealtime(
      <Feed taskId="task-1" query={query} />,
    );
    const socket = authenticateAndSubscribe();
    await screen.findByText('Original Workspace');
    const initialRequests = query.mock.calls.length;

    rerenderRealtime(
      <Feed taskId="task-1" query={query} />,
      'session-token',
      'workspace-2',
    );
    await waitFor(() =>
      expect(socket.sent.map((message) => JSON.parse(message))).toContainEqual({
        version: 1,
        type: 'subscribe',
        workspace_id: 'workspace-2',
      }),
    );
    act(() => socket.receive(taskEvent('task.comment.created', 'task-1')));
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(query).toHaveBeenCalledTimes(initialRequests);
  });

  it('tears down the old identity and never reconnects after unmount', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const { rerenderRealtime, unmount } = renderRealtime(<div>Workspace</div>);
    const first = authenticateAndSubscribe();

    rerenderRealtime(<div>Workspace</div>, 'replacement-token');
    expect(first.readyState).toBe(FakeWebSocket.CLOSED);
    expect(FakeWebSocket.instances).toHaveLength(2);
    const replacement = FakeWebSocket.instances[1]!;
    act(() => replacement.open());
    expect(JSON.parse(replacement.sent[0]!)).toMatchObject({
      type: 'authenticate',
      token: 'replacement-token',
    });

    unmount();
    act(() => vi.advanceTimersByTime(60_000));
    expect(replacement.readyState).toBe(FakeWebSocket.CLOSED);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it('ends the connection without retrying when realtime authentication expires', () => {
    vi.useFakeTimers();
    const unauthorized = vi.fn();
    const unsubscribe = subscribeToUnauthorizedRequests(unauthorized);
    try {
      renderRealtime(<div>Workspace</div>);
      const socket = authenticateAndSubscribe();

      act(() =>
        socket.receive({ version: 1, type: 'error', code: 'unauthorized' }),
      );
      expect(unauthorized).toHaveBeenCalledWith('session-token');
      expect(socket.readyState).toBe(FakeWebSocket.CLOSED);
      act(() => vi.advanceTimersByTime(60_000));
      expect(FakeWebSocket.instances).toHaveLength(1);
    } finally {
      unsubscribe();
    }
  });

  it('keeps one live connection under React StrictMode and ignores bad events', async () => {
    const queryClient = createQueryClient();
    const invalidations = vi.spyOn(queryClient, 'invalidateQueries');
    render(
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          <RealtimeProvider serverUrl={serverUrl} token="session-token">
            <Workspace workspaceId="workspace-1" />
          </RealtimeProvider>
        </QueryClientProvider>
      </StrictMode>,
    );
    const live = FakeWebSocket.instances.at(-1)!;
    act(() => live.open());
    act(() => live.receive({ version: 1, type: 'authenticated' }));
    invalidations.mockClear();

    act(() => {
      live.receive('{malformed');
      live.receive({ version: 1, type: 'future.event' });
    });

    expect(
      FakeWebSocket.instances.filter(
        (socket) => socket.readyState !== FakeWebSocket.CLOSED,
      ),
    ).toHaveLength(1);
    expect(invalidations).not.toHaveBeenCalled();
  });
});

function renderRealtime(children: ReactNode) {
  const queryClient = createQueryClient();
  const realtimeTree = (
    nextChildren: ReactNode,
    token: string,
    workspaceId = 'workspace-1',
  ) => (
    <QueryClientProvider client={queryClient}>
      <RealtimeProvider serverUrl={serverUrl} token={token}>
        <Workspace workspaceId={workspaceId} />
        {nextChildren}
      </RealtimeProvider>
    </QueryClientProvider>
  );
  const result = render(realtimeTree(children, 'session-token'));
  return {
    queryClient,
    ...result,
    rerenderRealtime(
      nextChildren: ReactNode,
      token: string,
      workspaceId = 'workspace-1',
    ) {
      result.rerender(realtimeTree(nextChildren, token, workspaceId));
    },
  };
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
}

function Workspace({ workspaceId }: { workspaceId: string }) {
  useRealtimeWorkspace(workspaceId);
  return null;
}

function Feed({
  taskId,
  query,
}: {
  taskId: string;
  query: () => Promise<string>;
}) {
  const feed = useQuery({
    queryKey: ['task-feed', 'workspace-1', taskId],
    queryFn: query,
  });
  return <div>{feed.data}</div>;
}

function authenticateAndSubscribe() {
  const socket = FakeWebSocket.instances.at(-1)!;
  act(() => socket.open());
  act(() => socket.receive({ version: 1, type: 'authenticated' }));
  expect(socket.sent.map((message) => JSON.parse(message))).toContainEqual({
    version: 1,
    type: 'subscribe',
    workspace_id: 'workspace-1',
  });
  act(() =>
    socket.receive({
      version: 1,
      type: 'subscribed',
      workspace_id: 'workspace-1',
    }),
  );
  return socket;
}

function taskEvent(type: string, taskId: string) {
  return {
    version: 1,
    id: `event-${taskId}`,
    type,
    workspace_id: 'workspace-1',
    task_id: taskId,
    entity_id: 'comment-1',
    occurred_at: '2026-09-12T12:00:00Z',
  };
}

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readonly url: string;
  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  private listeners = new Map<string, Set<(event: MessageEvent) => void>>();

  constructor(url: string | URL) {
    this.url = String(url);
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  send(message: string) {
    this.sent.push(message);
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.dispatch('open', new MessageEvent('open'));
  }

  receive(message: object | string) {
    const data =
      typeof message === 'string' ? message : JSON.stringify(message);
    this.dispatch('message', new MessageEvent('message', { data }));
  }

  serverClose() {
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatch('close', new MessageEvent('close'));
  }

  close() {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatch('close', new MessageEvent('close'));
  }

  private dispatch(type: string, event: MessageEvent) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}
