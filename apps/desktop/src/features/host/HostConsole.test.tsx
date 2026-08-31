import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { HostConsole } from './HostConsole';

vi.mock('./HostWorkspaces', () => ({
  HostWorkspaces: () => <div>Workspace list</div>,
}));
vi.mock('./HostAccessSettings', () => ({
  HostAccessSettings: () => <div>Access policy</div>,
}));

beforeAll(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

const host = {
  id: 'host-1',
  email: 'host@example.com',
  display_name: 'Host Account',
  is_host: true,
  theme: 'system' as const,
  timezone: 'UTC',
  week_start: 'monday' as const,
  date_format: 'locale' as const,
  active_workspace_id: 'workspace-1',
};

describe('HostConsole', () => {
  it('navigates its two Settings surfaces and returns to the Workspace', () => {
    const onClose = vi.fn();
    renderConsole({ onClose });

    expect(
      screen.getByRole('region', { name: 'Host Console' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Workspace list')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Access' }));
    expect(screen.getByText('Access policy')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to Workspace' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('keeps retained-account switching in the Host rail', () => {
    const onSwitchAccount = vi.fn();
    renderConsole({ onSwitchAccount });

    fireEvent.click(screen.getByRole('button', { name: 'Switch account' }));
    fireEvent.click(
      screen.getByRole('menuitemradio', { name: /Regular Account/ }),
    );
    expect(onSwitchAccount).toHaveBeenCalledWith('user-2');
    expect(
      screen.queryByRole('menuitem', { name: 'Settings' }),
    ).not.toBeInTheDocument();
  });
});

function renderConsole(
  overrides: Partial<Parameters<typeof HostConsole>[0]> = {},
) {
  const props: Parameters<typeof HostConsole>[0] = {
    context: {
      serverUrl: 'https://kanleaf.example.com',
      token: 'host-token',
    },
    user: host,
    accountSessions: [
      account('host-1', 'Host Account'),
      account('user-2', 'Regular Account'),
    ],
    accountTransitioning: false,
    accountError: null,
    onSwitchAccount: vi.fn(),
    onAddAccount: vi.fn(),
    onDismissAccountError: vi.fn(),
    onSignOut: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <HostConsole {...props} />
    </QueryClientProvider>,
  );
}

function account(userId: string, displayName: string) {
  return {
    user_id: userId,
    email: `${userId}@example.com`,
    display_name: displayName,
    token: `${userId}-token`,
    expires_at: '2026-09-30T00:00:00Z',
    last_used_at: '2026-09-01T00:00:00Z',
  };
}
