import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InvitationComposer } from './InvitationComposer';

describe('InvitationComposer', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('creates an invitation and reveals its one-time token', async () => {
    const invitation = {
      id: 'invitation-1',
      workspace_id: 'workspace-1',
      workspace_name: 'Kanleaf Core',
      workspace_identifier: 'kanleaf-core',
      email: 'member@example.com',
      role: 'member',
      invited_by_display_name: 'Owner',
      status: 'pending',
      token: 'invite-token',
      delivery: 'failed',
      invitation_url: 'https://kanleaf.example.com/invite#token=invite-token',
      expires_at: '2026-09-08T00:00:00Z',
      created_at: '2026-09-01T00:00:00Z',
      updated_at: '2026-09-01T00:00:00Z',
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(invitation), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const onInvitationCreated = vi.fn();
    render(
      <InvitationComposer
        context={{
          serverUrl: 'https://kanleaf.example.com',
          token: 'session-token',
        }}
        workspaceId="workspace-1"
        onInvitationCreated={onInvitationCreated}
      />,
    );

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'member@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create invitation' }));

    expect(await screen.findByDisplayValue('invite-token')).toBeInTheDocument();
    expect(
      screen.getByText('Invitation created, but the email could not be sent'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Invitation link')).toHaveValue(
      invitation.invitation_url,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(invitation.invitation_url),
    );
    expect(screen.getByText('Invitation link copied')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveValue('');
    await waitFor(() =>
      expect(onInvitationCreated).toHaveBeenCalledWith(invitation),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://kanleaf.example.com/api/workspaces/workspace-1/invitations',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'member@example.com', role: 'member' }),
      }),
    );
  });
});
