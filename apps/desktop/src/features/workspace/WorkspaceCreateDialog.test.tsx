import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Workspace } from './types';
import { WorkspaceCreateDialog } from './WorkspaceCreateDialog';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute('open');
  };
});

const workspace: Workspace = {
  id: 'workspace-3',
  identifier: 'personal-notes',
  name: 'Personal notes',
  accent: 'sage',
  role: 'owner',
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
};

describe('WorkspaceCreateDialog', () => {
  it('keeps the dialog open for optional invitations before navigation', async () => {
    const onCreate = vi.fn().mockResolvedValue(workspace);
    const onFinished = vi.fn();
    const onClose = vi.fn();
    render(
      <WorkspaceCreateDialog
        context={{ serverUrl: 'https://kanleaf.example.com', token: 'token' }}
        onCreate={onCreate}
        onFinished={onFinished}
        onClose={onClose}
      />,
    );

    fireEvent.change(screen.getByLabelText('Workspace name'), {
      target: { value: 'Personal notes' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Workspace' }));

    const inviteHeading = await screen.findByRole('heading', {
      name: 'Invite people to Personal notes',
    });
    await waitFor(() => expect(inviteHeading).toHaveFocus());
    expect(onCreate).toHaveBeenCalledWith({
      name: 'Personal notes',
      identifier: 'personal-notes',
    });
    expect(onFinished).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Skip invitations' }));
    await waitFor(() => expect(onFinished).toHaveBeenCalledWith(workspace));
  });
});
