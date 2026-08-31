import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listHostWorkspaces } from './api';
import { HostWorkspaces } from './HostWorkspaces';

vi.mock('./api', () => ({ listHostWorkspaces: vi.fn() }));

const context = {
  serverUrl: 'https://kanleaf.example.com',
  token: 'host-token',
};

describe('HostWorkspaces', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders a compact semantic Workspace and Owner table', async () => {
    vi.mocked(listHostWorkspaces).mockResolvedValue([
      {
        id: 'workspace-1',
        name: 'Kanleaf Core',
        created_at: '2026-09-01T00:00:00Z',
        owner: {
          id: 'owner-1',
          display_name: 'Quang Tran',
          email: 'quang@example.com',
        },
      },
    ]);
    renderWithClient(<HostWorkspaces context={context} />);

    const table = await screen.findByRole('table', {
      name: 'All Workspaces and their Owners',
    });
    expect(table).toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: 'Workspace' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: 'Owner' }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('rowheader', { name: 'Kanleaf Core' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Quang Tran')).toBeInTheDocument();
    expect(screen.getByText('quang@example.com')).toBeInTheDocument();
    expect(screen.getByText('1 workspace')).toBeInTheDocument();
  });

  it('renders loading and empty states', async () => {
    let resolveWorkspaces: (value: []) => void = () => undefined;
    vi.mocked(listHostWorkspaces).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveWorkspaces = resolve;
        }),
    );
    const rendered = renderWithClient(<HostWorkspaces context={context} />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading Workspaces…');
    expect(screen.getByRole('table')).toHaveAttribute('aria-busy', 'true');
    resolveWorkspaces([]);
    expect(await screen.findByText('No Workspaces yet')).toBeInTheDocument();
    rendered.unmount();
  });

  it('keeps a failed list retryable', async () => {
    vi.mocked(listHostWorkspaces)
      .mockRejectedValueOnce(new Error('Database unavailable'))
      .mockResolvedValueOnce([]);
    renderWithClient(<HostWorkspaces context={context} />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Database unavailable',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No Workspaces yet')).toBeInTheDocument();
    expect(listHostWorkspaces).toHaveBeenCalledTimes(2);
  });
});

function renderWithClient(children: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  );
}
