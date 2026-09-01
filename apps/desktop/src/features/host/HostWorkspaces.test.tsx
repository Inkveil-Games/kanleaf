import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteHostWorkspace, listHostWorkspaces } from './api';
import { HostWorkspaces } from './HostWorkspaces';

vi.mock('./api', () => ({
  deleteHostWorkspace: vi.fn(),
  listHostWorkspaces: vi.fn(),
}));

HTMLDialogElement.prototype.showModal = function showModal() {
  this.open = true;
};

HTMLDialogElement.prototype.close = function close() {
  this.open = false;
};

const context = {
  serverUrl: 'https://kanleaf.example.com',
  token: 'host-token',
};

describe('HostWorkspaces', () => {
  beforeEach(() => vi.resetAllMocks());

  it('renders a compact semantic Workspace and Owner table', async () => {
    vi.mocked(listHostWorkspaces).mockResolvedValue([
      {
        id: 'workspace-1',
        identifier: 'kanleaf-core',
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
      screen.getByRole('columnheader', { name: 'Actions' }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('rowheader', { name: /Kanleaf Core/ }),
    ).toBeInTheDocument();
    expect(screen.getByText('Quang Tran')).toBeInTheDocument();
    expect(screen.getByText('quang@example.com')).toBeInTheDocument();
    expect(screen.getByText('/kanleaf-core')).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'Delete Workspace “Kanleaf Core” (/kanleaf-core)',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText('1 workspace')).toBeInTheDocument();
  });

  it('disambiguates duplicate Workspace names with immutable identifiers', async () => {
    const duplicateWorkspace = {
      ...workspace,
      id: 'workspace-2',
      identifier: 'kanleaf-labs',
      owner: {
        id: 'owner-2',
        display_name: 'Lan Nguyen',
        email: 'lan@example.com',
      },
    };
    vi.mocked(listHostWorkspaces).mockResolvedValue([
      workspace,
      duplicateWorkspace,
    ]);
    vi.mocked(deleteHostWorkspace).mockResolvedValue(undefined);
    renderWithClient(<HostWorkspaces context={context} />);

    expect(
      await screen.findByRole('button', {
        name: 'Delete Workspace “Kanleaf Core” (/kanleaf-core)',
      }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Delete Workspace “Kanleaf Core” (/kanleaf-labs)',
      }),
    );

    expect(
      screen.getByRole('dialog', {
        name: 'Delete “Kanleaf Core” (/kanleaf-labs)?',
      }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(
      screen.getByRole('dialog', {
        name: 'Confirm permanent deletion of “Kanleaf Core” (/kanleaf-labs)',
      }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Workspace ID'), {
      target: { value: 'kanleaf-labs' },
    });
    fireEvent.change(screen.getByLabelText('Host password'), {
      target: { value: 'host-password' },
    });
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Permanently delete “Kanleaf Core” (/kanleaf-labs)',
      }),
    );

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Kanleaf Core (/kanleaf-labs) was permanently deleted',
    );
  });

  it('requires two warnings, the exact identifier, and the Host password', async () => {
    vi.mocked(listHostWorkspaces)
      .mockResolvedValueOnce([workspace])
      .mockResolvedValueOnce([]);
    vi.mocked(deleteHostWorkspace).mockResolvedValue(undefined);
    renderWithClient(<HostWorkspaces context={context} />);

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Delete Workspace “Kanleaf Core” (/kanleaf-core)',
      }),
    );
    const dialog = screen.getByRole('dialog', {
      name: 'Delete “Kanleaf Core” (/kanleaf-core)?',
    });
    expect(dialog).toHaveTextContent('Quang Tran');
    expect(dialog).toHaveTextContent('Tasks, Projects, Library notes');
    expect(deleteHostWorkspace).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(
      screen.getByRole('heading', {
        name: 'Confirm permanent deletion of “Kanleaf Core” (/kanleaf-core)',
      }),
    ).toBeInTheDocument();
    const remove = screen.getByRole('button', {
      name: 'Permanently delete “Kanleaf Core” (/kanleaf-core)',
    });
    expect(remove).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Workspace ID'), {
      target: { value: 'kanleaf-core' },
    });
    fireEvent.change(screen.getByLabelText('Host password'), {
      target: { value: 'host-password' },
    });
    expect(remove).toBeEnabled();
    fireEvent.click(remove);

    expect(deleteHostWorkspace).toHaveBeenCalledWith(context, 'workspace-1', {
      identifier: 'kanleaf-core',
      password: 'host-password',
    });
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Kanleaf Core (/kanleaf-core) was permanently deleted',
    );
    await waitFor(() =>
      expect(
        screen.queryByRole('rowheader', { name: /Kanleaf Core/ }),
      ).not.toBeInTheDocument(),
    );
  });

  it('supports Back and preserves the identifier while clearing a failed password', async () => {
    vi.mocked(listHostWorkspaces).mockResolvedValue([workspace]);
    vi.mocked(deleteHostWorkspace).mockRejectedValue(
      new Error('Password is incorrect'),
    );
    renderWithClient(<HostWorkspaces context={context} />);

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Delete Workspace “Kanleaf Core” (/kanleaf-core)',
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(
      screen.getByRole('heading', {
        name: 'Delete “Kanleaf Core” (/kanleaf-core)?',
      }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    const identifier = screen.getByLabelText('Workspace ID');
    const password = screen.getByLabelText('Host password');
    fireEvent.change(identifier, { target: { value: 'kanleaf-core' } });
    fireEvent.change(password, { target: { value: 'wrong-password' } });
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Permanently delete “Kanleaf Core” (/kanleaf-core)',
      }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Password is incorrect',
    );
    expect(identifier).toHaveValue('kanleaf-core');
    expect(password).toHaveValue('');
    expect(
      screen.getByRole('dialog', {
        name: 'Confirm permanent deletion of “Kanleaf Core” (/kanleaf-core)',
      }),
    ).toBeInTheDocument();
  });

  it('cannot be dismissed or submitted twice while deletion is running', async () => {
    let finishDelete: () => void = () => undefined;
    vi.mocked(listHostWorkspaces).mockResolvedValue([workspace]);
    vi.mocked(deleteHostWorkspace).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishDelete = resolve;
        }),
    );
    renderWithClient(<HostWorkspaces context={context} />);

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Delete Workspace “Kanleaf Core” (/kanleaf-core)',
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.change(screen.getByLabelText('Workspace ID'), {
      target: { value: 'kanleaf-core' },
    });
    fireEvent.change(screen.getByLabelText('Host password'), {
      target: { value: 'host-password' },
    });
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Permanently delete “Kanleaf Core” (/kanleaf-core)',
      }),
    );

    const dialog = screen.getByRole('dialog', {
      name: 'Confirm permanent deletion of “Kanleaf Core” (/kanleaf-core)',
    });
    expect(
      screen.getByRole('button', {
        name: 'Deleting “Kanleaf Core” (/kanleaf-core)…',
      }),
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    fireEvent.click(dialog);
    expect(dialog).toBeInTheDocument();
    expect(deleteHostWorkspace).toHaveBeenCalledTimes(1);

    finishDelete();
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
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

const workspace = {
  id: 'workspace-1',
  identifier: 'kanleaf-core',
  name: 'Kanleaf Core',
  created_at: '2026-09-01T00:00:00Z',
  owner: {
    id: 'owner-1',
    display_name: 'Quang Tran',
    email: 'quang@example.com',
  },
};

function renderWithClient(children: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  );
}
