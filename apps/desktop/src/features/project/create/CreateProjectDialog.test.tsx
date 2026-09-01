import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { chooseSelectOption } from '../../../test/select';
import type {
  Project,
  ProjectCreateInput,
  Workspace,
  WorkspaceMember,
} from '../../workspace/types';
import { CreateProjectDialog } from './CreateProjectDialog';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute('open');
  };
});

const workspace: Workspace = {
  id: 'workspace-1',
  identifier: 'kanleaf-core',
  name: 'Kanleaf Core',
  accent: 'sage',
  role: 'owner',
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
};

const members: WorkspaceMember[] = [
  {
    user_id: 'user-1',
    email: 'owner@example.com',
    display_name: 'Owner',
    role: 'owner',
    joined_at: workspace.created_at,
    updated_at: workspace.updated_at,
  },
  {
    user_id: 'user-2',
    email: 'member@example.com',
    display_name: 'Minh',
    role: 'member',
    joined_at: workspace.created_at,
    updated_at: workspace.updated_at,
  },
  {
    user_id: 'guest-1',
    email: 'guest@example.com',
    display_name: 'Guest',
    role: 'guest',
    joined_at: workspace.created_at,
    updated_at: workspace.updated_at,
  },
];

describe('CreateProjectDialog', () => {
  it('submits the reviewed identity, icon, lead, and visibility', async () => {
    const onCreate = vi.fn().mockResolvedValue({ id: 'project-1' } as Project);
    const onClose = vi.fn();
    renderDialog(onCreate, onClose);

    fireEvent.change(screen.getByLabelText('Project name'), {
      target: { value: 'Ứng dụng Di động' },
    });
    expect(screen.getByLabelText('Project ID')).toHaveValue('ung-dung-di-dong');

    fireEvent.change(screen.getByLabelText('Project ID'), {
      target: { value: 'mobile-client' },
    });
    fireEvent.change(screen.getByLabelText('Project name'), {
      target: { value: 'Mobile Client' },
    });
    expect(screen.getByLabelText('Project ID')).toHaveValue('mobile-client');

    fireEvent.click(
      screen.getByRole('button', { name: 'Choose Project icon' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Rocket' }));
    fireEvent.click(screen.getByRole('combobox', { name: 'Project lead' }));
    expect(screen.getByText(/Becomes Project Admin/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: 'Minh' }));
    chooseSelectOption('Project visibility', 'Public');
    fireEvent.change(screen.getByLabelText(/Description/), {
      target: { value: 'Ship a focused mobile experience.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Project' }));

    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith({
        name: 'Mobile Client',
        identifier: 'mobile-client',
        description: 'Ship a focused mobile experience.',
        icon: 'rocket',
        lead_user_id: 'user-2',
        visibility: 'public',
      }),
    );
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByText('Guest')).not.toBeInTheDocument();
  });

  it('resets an edited Project ID from the current name', () => {
    renderDialog(vi.fn(), vi.fn());

    fireEvent.change(screen.getByLabelText('Project name'), {
      target: { value: 'Product Launch' },
    });
    fireEvent.change(screen.getByLabelText('Project ID'), {
      target: { value: 'launch-v2' },
    });
    fireEvent.change(screen.getByLabelText('Project name'), {
      target: { value: 'Product Launch 2027' },
    });
    expect(screen.getByLabelText('Project ID')).toHaveValue('launch-v2');

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(screen.getByLabelText('Project ID')).toHaveValue(
      'product-launch-2027',
    );
  });

  it('supports keyboard navigation and returns focus when the icon picker closes', () => {
    renderDialog(vi.fn(), vi.fn());
    const trigger = screen.getByRole('button', {
      name: 'Choose Project icon',
    });
    fireEvent.click(trigger);

    const search = screen.getByPlaceholderText('Search icons');
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    expect(screen.getByRole('button', { name: 'Folder' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    expect(screen.getByRole('button', { name: 'Target' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });

    expect(
      screen.queryByRole('dialog', { name: 'Project icons' }),
    ).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('submits from the description shortcut and blocks duplicate dismissal while busy', async () => {
    let finishCreate: ((project: Project) => void) | undefined;
    const onCreate = vi.fn(
      () =>
        new Promise<Project>((resolve) => {
          finishCreate = resolve;
        }),
    );
    const onClose = vi.fn();
    renderDialog(onCreate, onClose);

    fireEvent.change(screen.getByLabelText('Project name'), {
      target: { value: 'Keyboard Project' },
    });
    fireEvent.keyDown(screen.getByLabelText(/Description/), {
      key: 'Enter',
      ctrlKey: true,
    });

    await waitFor(() => expect(onCreate).toHaveBeenCalledOnce());
    expect(screen.getByRole('button', { name: 'Creating…' })).toBeDisabled();
    expect(screen.getByLabelText('Project name')).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Close Project creation' }),
    ).toBeDisabled();
    fireEvent(
      screen.getByRole('dialog', { name: 'Create a Project' }),
      new Event('cancel', { cancelable: true }),
    );
    expect(onClose).not.toHaveBeenCalled();

    finishCreate?.({ id: 'project-1' } as Project);
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });
});

function renderDialog(
  onCreate: (input: ProjectCreateInput) => Promise<Project>,
  onClose: () => void,
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(['workspace-members', workspace.id], members);
  return render(
    <QueryClientProvider client={queryClient}>
      <CreateProjectDialog
        context={{ serverUrl: 'https://kanleaf.example.com', token: 'token' }}
        workspace={workspace}
        currentUser={{ id: 'user-1', displayName: 'Owner' }}
        onCreate={onCreate}
        onClose={onClose}
      />
    </QueryClientProvider>,
  );
}
