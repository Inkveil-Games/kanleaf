import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState, type ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceDocument } from '../document/types';
import type { Project, Task } from '../workspace/types';
import { CommandPalette } from './CommandPalette';

HTMLDialogElement.prototype.showModal = function showModal() {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close = function close() {
  this.removeAttribute('open');
};

const api = vi.hoisted(() => ({
  listDocuments: vi.fn(),
  queryTasks: vi.fn(),
}));

vi.mock('../document/api', () => ({ listDocuments: api.listDocuments }));
vi.mock('../view/api', () => ({ queryTasks: api.queryTasks }));

const project: Project = {
  id: 'project-1',
  workspace_id: 'workspace-1',
  name: 'Kanleaf Core',
  identifier: 'KAN',
  description: '',
  lead_user_id: null,
  visibility: 'private',
  default_assignee_id: null,
  default_state_id: 'state-1',
  default_task_type_id: 'type-1',
  cycles_enabled: true,
  modules_enabled: true,
  pages_enabled: true,
  views_enabled: true,
  enabled_task_type_ids: ['type-1'],
  effective_role: 'contributor',
  can_join: false,
  archived_at: null,
  created_at: '2026-08-29T00:00:00Z',
  updated_at: '2026-08-29T00:00:00Z',
};

const task = {
  id: 'task-1',
  project_id: 'project-1',
  reference: 'KAN-14',
  title: 'Architecture review',
} as Task;

const note: WorkspaceDocument = {
  id: 'document-1',
  workspace_id: 'workspace-1',
  project_id: 'project-1',
  parent_id: null,
  title: 'Architecture notes',
  storage_name: 'architecture_notes',
  library_path: 'Wiki/architecture_notes.md',
  position: 0,
  can_edit: true,
  archived_at: null,
  created_at: '2026-08-29T00:00:00Z',
  updated_at: '2026-08-29T00:00:00Z',
};

function renderPalette(
  overrides: Partial<ComponentProps<typeof CommandPalette>> = {},
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const props: ComponentProps<typeof CommandPalette> = {
    context: {
      serverUrl: 'https://kanleaf.example.com',
      token: 'session-token',
    },
    workspaceId: 'workspace-1',
    projects: [project],
    canUseWorkspaceContent: true,
    onClose: vi.fn(),
    onOpenCollection: vi.fn(),
    onOpenProject: vi.fn(),
    onOpenTask: vi.fn(),
    onOpenDocument: vi.fn(),
    onOpenLibrary: vi.fn(),
    onOpenAccountSettings: vi.fn(),
    onOpenWorkspaceSettings: vi.fn(),
    ...overrides,
  };
  render(
    <QueryClientProvider client={client}>
      <CommandPalette {...props} />
    </QueryClientProvider>,
  );
  return props;
}

describe('CommandPalette', () => {
  beforeEach(() => {
    api.listDocuments.mockReset().mockResolvedValue([note]);
    api.queryTasks.mockReset().mockResolvedValue([task]);
  });

  it('searches authorized tasks and Library notes using existing APIs', async () => {
    const props = renderPalette();
    const input = screen.getByRole('combobox', {
      name: 'Search Kanleaf',
    });

    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: 'architecture' } });

    expect(
      await screen.findByRole('option', { name: /Architecture review/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: /Architecture notes/ }),
    ).toBeInTheDocument();
    expect(api.queryTasks).toHaveBeenCalledWith(
      expect.anything(),
      'workspace-1',
      expect.objectContaining({
        scope: { kind: 'workspace' },
        search: 'architecture',
      }),
    );

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(props.onOpenTask).toHaveBeenCalledWith(task);
    expect(props.onClose).toHaveBeenCalled();
  });

  it('supports Arrow navigation and opens the selected Library result', async () => {
    const props = renderPalette();
    const input = screen.getByRole('combobox', { name: 'Search Kanleaf' });
    fireEvent.change(input, { target: { value: 'architecture' } });
    await screen.findByRole('option', { name: /Architecture review/ });

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(props.onOpenDocument).toHaveBeenCalledWith(note);
    expect(props.onClose).toHaveBeenCalled();
  });

  it('shows navigation commands and restores focus when Escape closes it', async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <QueryClientProvider client={new QueryClient()}>
          <button type="button" onClick={() => setOpen(true)}>
            Open commands
          </button>
          {open && (
            <CommandPalette
              context={{ serverUrl: 'https://kanleaf.example.com', token: 'x' }}
              workspaceId="workspace-1"
              projects={[project]}
              canUseWorkspaceContent
              onClose={() => setOpen(false)}
              onOpenCollection={vi.fn()}
              onOpenProject={vi.fn()}
              onOpenTask={vi.fn()}
              onOpenDocument={vi.fn()}
              onOpenLibrary={vi.fn()}
              onOpenAccountSettings={vi.fn()}
              onOpenWorkspaceSettings={vi.fn()}
            />
          )}
        </QueryClientProvider>
      );
    }

    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Open commands' });
    trigger.focus();
    fireEvent.click(trigger);

    expect(screen.getByRole('option', { name: /^Inbox/ })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });

    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
