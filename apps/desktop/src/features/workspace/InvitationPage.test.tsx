import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { User } from '../../lib/api/types';
import type { WorkspaceInvitationPreview } from './types';
import { InvitationPage } from './InvitationPage';
import { invitationTokenFromHash } from './invitationToken';

const invitationToken = 'A'.repeat(43);
const preview: WorkspaceInvitationPreview = {
  status: 'pending',
  workspace_name: 'Inkveil Games',
  workspace_identifier: 'inkveil-games',
  invited_by_display_name: 'Quang',
  role: 'member',
  expires_at: '2026-09-16T12:30:00Z',
  invitee_email_hint: 'a***@example.com',
  account_email_matches: null,
};
const user: User = {
  id: 'user-1',
  email: 'alice@example.com',
  display_name: 'Alice',
  is_host: false,
  theme: 'system',
  timezone: 'UTC',
  week_start: 'monday',
  date_format: 'locale',
  active_workspace_id: null,
  setup_stage: 'complete',
};

describe('InvitationPage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reads the fragment, resolves metadata, and never accepts on load', async () => {
    const fetchMock = previewFetch(preview);
    renderPage();

    expect(
      await screen.findByRole('heading', { name: 'Inkveil Games' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Quang invited you/)).toBeInTheDocument();
    expect(screen.getByText('Member')).toBeInTheDocument();
    expect(screen.getByText(/a\*\*\*@example.com/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
    expect(
      screen.getByRole('button', { name: 'Create account' }),
    ).toBeEnabled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://kanleaf.example.com/api/invitations/resolve',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ token: invitationToken }),
      }),
    );
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).endsWith('/api/invitations/accept-token'),
      ),
    ).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(
      screen.getByRole('heading', { name: 'Create your account' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent(
      `/invite#token=${invitationToken}`,
    );
  });

  it('keeps the invitation destination when sign-in opens password recovery', async () => {
    previewFetch(preview);
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Sign in' }));
    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));

    expect(screen.getByTestId('location')).toHaveTextContent(
      `/forgot-password#returnTo=${encodeURIComponent(`/invite#token=${invitationToken}`)}`,
    );
    expect(screen.getByTestId('location-state')).toHaveTextContent('null');
  });

  it('requires an explicit Join action and redirects after acceptance', async () => {
    const fetchMock = previewFetch({
      ...preview,
      account_email_matches: true,
    });
    const flushDocumentSaves = vi.fn().mockResolvedValue(undefined);
    const onSessionChanged = vi.fn().mockResolvedValue(undefined);
    renderPage({
      accountToken: 'session-token',
      user,
      flushDocumentSaves,
      onSessionChanged,
    });

    const join = await screen.findByRole('button', { name: 'Join workspace' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(join);

    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(
        '/w/inkveil-games/my-work',
      ),
    );
    expect(flushDocumentSaves).toHaveBeenCalledOnce();
    expect(onSessionChanged).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://kanleaf.example.com/api/invitations/accept-token',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ token: invitationToken }),
      }),
    );
  });

  it('blocks the wrong account and offers an account switch', async () => {
    previewFetch({ ...preview, account_email_matches: false });
    const onSignOut = vi.fn().mockResolvedValue(undefined);
    renderPage({ accountToken: 'other-session', user, onSignOut });

    expect(
      await screen.findByRole('heading', { name: 'Use the invited account' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Join workspace' })).toBeNull();
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Sign out and use another account',
      }),
    );
    expect(onSignOut).toHaveBeenCalledOnce();
  });

  it('preserves the fragment through required account details', async () => {
    previewFetch({ ...preview, account_email_matches: true });
    renderPage({
      accountToken: 'session-token',
      user: { ...user, setup_stage: 'account' },
    });

    fireEvent.click(
      await screen.findByRole('button', { name: 'Complete account setup' }),
    );
    expect(screen.getByTestId('location')).toHaveTextContent('/setup/account');
    expect(screen.getByTestId('location-state')).toHaveTextContent(
      `/invite#token=${invitationToken}`,
    );
  });

  it.each([
    ['expired', 'Invitation expired'],
    ['revoked', 'Invitation revoked'],
    ['accepted', 'Invitation already accepted'],
    ['declined', 'Invitation declined'],
    ['invalid', 'Invitation link is invalid'],
  ] as const)('renders the %s state', async (status, heading) => {
    previewFetch({
      ...preview,
      status,
      ...(status === 'invalid'
        ? { workspace_name: null, workspace_identifier: null }
        : {}),
    });
    renderPage();
    expect(
      await screen.findByRole('heading', { name: heading }),
    ).toBeInTheDocument();
  });

  it('keeps acceptance failures generic, token-free, and focused', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          ...preview,
          account_email_matches: true,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              code: 'conflict',
              message: `Provider rejected ${invitationToken}`,
            },
          }),
          { status: 409, headers: { 'content-type': 'application/json' } },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);
    renderPage({ accountToken: 'session-token', user });

    fireEvent.click(
      await screen.findByRole('button', { name: 'Join workspace' }),
    );
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Kanleaf could not join this Workspace');
    expect(alert).not.toHaveTextContent(invitationToken);
    expect(alert).toHaveFocus();
  });

  it('retries session refresh without accepting a committed invitation twice', async () => {
    const fetchMock = previewFetch({
      ...preview,
      account_email_matches: true,
    });
    const onSessionChanged = vi
      .fn()
      .mockRejectedValueOnce(new Error('Session refresh failed'))
      .mockResolvedValueOnce(undefined);
    renderPage({ accountToken: 'session-token', user, onSessionChanged });

    fireEvent.click(
      await screen.findByRole('button', { name: 'Join workspace' }),
    );
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'Workspace joined, but Kanleaf could not refresh your session',
    );
    expect(
      screen.queryByRole('button', { name: 'Join workspace' }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open workspace' }));

    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(
        '/w/inkveil-games/my-work',
      ),
    );
    expect(onSessionChanged).toHaveBeenCalledTimes(2);
    expect(
      fetchMock.mock.calls.filter(([url]) =>
        String(url).endsWith('/api/invitations/accept-token'),
      ),
    ).toHaveLength(1);
  });

  it('reports a missing fragment without making a request', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderPage({ initialEntry: '/invite' });
    expect(
      screen.getByRole('heading', { name: 'Invitation link is invalid' }),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

it('parses only the token fragment parameter', () => {
  expect(invitationTokenFromHash(`#token=${invitationToken}`)).toBe(
    invitationToken,
  );
  expect(invitationTokenFromHash('#other=value')).toBeNull();
});

function renderPage({
  initialEntry = `/invite#token=${invitationToken}`,
  accountToken = null,
  user: currentUser = null,
  onSignOut = vi.fn(),
  flushDocumentSaves = vi.fn().mockResolvedValue(undefined),
  onSessionChanged = vi.fn().mockResolvedValue(undefined),
}: {
  initialEntry?: string;
  accountToken?: string | null;
  user?: User | null;
  onSignOut?: () => void | Promise<void>;
  flushDocumentSaves?: () => Promise<void>;
  onSessionChanged?: () => Promise<void>;
} = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <InvitationPage
          serverUrl="https://kanleaf.example.com"
          accountToken={accountToken}
          user={currentUser}
          onAuthenticated={vi.fn()}
          onSessionChanged={onSessionChanged}
          onSignOut={onSignOut}
          flushDocumentSaves={flushDocumentSaves}
        />
        <LocationOutput />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function previewFetch(value: WorkspaceInvitationPreview) {
  const fetchMock = vi.fn(async (input: string | URL | Request) =>
    String(input).endsWith('/api/invitations/accept-token')
      ? new Response(null, { status: 204 })
      : jsonResponse(value),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function LocationOutput() {
  const location = useLocation();
  return (
    <>
      <output data-testid="location">
        {location.pathname}
        {location.hash}
      </output>
      <output data-testid="location-state">
        {JSON.stringify(location.state)}
      </output>
    </>
  );
}
