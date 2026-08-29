import { useQuery } from '@tanstack/react-query';
import {
  BookOpenText,
  CheckSquare2,
  FileText,
  Folder,
  Inbox,
  ListTodo,
  Search,
  Settings,
  UserRound,
} from 'lucide-react';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { listDocuments } from '../document/api';
import type { WorkspaceDocument } from '../document/types';
import { queryTasks } from '../view/api';
import { createTaskQuery } from '../view/types';
import type { ApiContext } from '../workspace/api';
import type { Collection, Project, Task } from '../workspace/types';

interface CommandPaletteProps {
  context: ApiContext;
  workspaceId: string;
  projects: Project[];
  canUseWorkspaceContent: boolean;
  onClose: () => void;
  onOpenCollection: (collection: Collection) => void;
  onOpenProject: (projectId: string) => void;
  onOpenTask: (task: Task) => void;
  onOpenDocument: (document: WorkspaceDocument) => void;
  onOpenLibrary: () => void;
  onOpenAccountSettings: () => void;
  onOpenWorkspaceSettings: () => void;
}

interface PaletteItem {
  id: string;
  group: 'Navigate' | 'Projects' | 'Tasks' | 'Library';
  label: string;
  detail?: string;
  icon: ReactNode;
  run: () => void;
}

export function CommandPalette({
  context,
  workspaceId,
  projects,
  canUseWorkspaceContent,
  onClose,
  onOpenCollection,
  onOpenProject,
  onOpenTask,
  onOpenDocument,
  onOpenLibrary,
  onOpenAccountSettings,
  onOpenWorkspaceSettings,
}: CommandPaletteProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const listId = useId();
  const [search, setSearch] = useState('');
  const [settledSearch, setSettledSearch] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    inputRef.current?.focus();
    return () => {
      if (dialog?.open) dialog.close();
      previousFocusRef.current?.focus();
    };
  }, []);

  useEffect(() => {
    const next = search.trim();
    if (!next) return;
    const timeout = window.setTimeout(() => setSettledSearch(next), 160);
    return () => window.clearTimeout(timeout);
  }, [search]);

  const documents = useQuery({
    queryKey: ['documents', workspaceId, 'all'],
    queryFn: () => listDocuments(context, workspaceId),
  });
  const taskSearch = useQuery({
    queryKey: ['command-search', 'tasks', workspaceId, settledSearch],
    queryFn: () => {
      const query = createTaskQuery({ kind: 'all' });
      query.search = settledSearch;
      return queryTasks(context, workspaceId, query);
    },
    enabled: Boolean(settledSearch),
  });

  const items = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase();
    const matches = (value: string) =>
      !normalizedSearch || value.toLocaleLowerCase().includes(normalizedSearch);
    const next: PaletteItem[] = [];
    const add = (item: PaletteItem) => {
      if (matches(`${item.label} ${item.detail ?? ''}`)) next.push(item);
    };

    if (canUseWorkspaceContent) {
      add({
        id: 'navigate-inbox',
        group: 'Navigate',
        label: 'Inbox',
        detail: 'Workspace tasks without a project',
        icon: <Inbox aria-hidden="true" size={16} />,
        run: () => onOpenCollection({ kind: 'inbox' }),
      });
      add({
        id: 'navigate-my-work',
        group: 'Navigate',
        label: 'My Work',
        detail: 'Tasks assigned to you',
        icon: <CheckSquare2 aria-hidden="true" size={16} />,
        run: () => onOpenCollection({ kind: 'my-work' }),
      });
      add({
        id: 'navigate-all-tasks',
        group: 'Navigate',
        label: 'All tasks',
        detail: 'Every accessible task in this Workspace',
        icon: <ListTodo aria-hidden="true" size={16} />,
        run: () => onOpenCollection({ kind: 'all' }),
      });
      add({
        id: 'navigate-library',
        group: 'Navigate',
        label: 'Library',
        detail: 'Workspace Markdown notes',
        icon: <BookOpenText aria-hidden="true" size={16} />,
        run: onOpenLibrary,
      });
    }
    add({
      id: 'account-settings',
      group: 'Navigate',
      label: 'Account settings',
      icon: <UserRound aria-hidden="true" size={16} />,
      run: onOpenAccountSettings,
    });
    add({
      id: 'workspace-settings',
      group: 'Navigate',
      label: 'Workspace settings',
      icon: <Settings aria-hidden="true" size={16} />,
      run: onOpenWorkspaceSettings,
    });

    for (const project of projects
      .filter((project) => matches(`${project.name} ${project.identifier}`))
      .slice(0, normalizedSearch ? 12 : 6)) {
      next.push({
        id: `project-${project.id}`,
        group: 'Projects',
        label: project.name,
        detail: project.identifier,
        icon: <Folder aria-hidden="true" size={16} />,
        run: () => onOpenProject(project.id),
      });
    }

    if (normalizedSearch && settledSearch === search.trim()) {
      for (const task of (taskSearch.data ?? []).slice(0, 8)) {
        next.push({
          id: `task-${task.id}`,
          group: 'Tasks',
          label: task.title,
          detail: task.reference,
          icon: <CheckSquare2 aria-hidden="true" size={16} />,
          run: () => onOpenTask(task),
        });
      }
      for (const document of (documents.data ?? [])
        .filter((document) =>
          matches(`${document.title} ${document.library_path}`),
        )
        .slice(0, 8)) {
        next.push({
          id: `document-${document.id}`,
          group: 'Library',
          label: document.title,
          detail: document.library_path,
          icon: <FileText aria-hidden="true" size={16} />,
          run: () => onOpenDocument(document),
        });
      }
    }
    return next;
  }, [
    canUseWorkspaceContent,
    documents.data,
    onOpenAccountSettings,
    onOpenCollection,
    onOpenDocument,
    onOpenLibrary,
    onOpenProject,
    onOpenTask,
    onOpenWorkspaceSettings,
    projects,
    search,
    settledSearch,
    taskSearch.data,
  ]);

  const selectedIndex = Math.min(activeIndex, Math.max(items.length - 1, 0));

  function run(item: PaletteItem | undefined) {
    if (!item) return;
    item.run();
    onClose();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (items.length === 0) return;
      const offset = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex(
        (current) => (current + offset + items.length) % items.length,
      );
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      setActiveIndex(event.key === 'Home' ? 0 : Math.max(items.length - 1, 0));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      run(items[selectedIndex]);
    }
  }

  const groupedItems = groupItems(items);
  const waitingForSearch = Boolean(
    search.trim() && settledSearch !== search.trim(),
  );
  const searching =
    waitingForSearch || taskSearch.isFetching || documents.isPending;

  return (
    <dialog
      ref={dialogRef}
      className="command-dialog"
      aria-label="Search and commands"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="command-palette">
        <div className="command-search">
          <Search aria-hidden="true" size={17} />
          <label className="sr-only" htmlFor={`${listId}-input`}>
            Search Kanleaf
          </label>
          <input
            ref={inputRef}
            id={`${listId}-input`}
            role="combobox"
            aria-autocomplete="list"
            aria-controls={listId}
            aria-expanded="true"
            aria-activedescendant={
              items[selectedIndex]
                ? `${listId}-${items[selectedIndex].id}`
                : undefined
            }
            placeholder="Search tasks, projects, Library, or commands"
            value={search}
            onChange={(event) => {
              const value = event.target.value;
              setSearch(value);
              setActiveIndex(0);
              if (!value.trim()) setSettledSearch('');
            }}
            onKeyDown={handleKeyDown}
          />
          <kbd>Esc</kbd>
        </div>
        <div id={listId} className="command-results" role="listbox">
          {groupedItems.map(([group, entries]) => (
            <section key={group} aria-label={group}>
              <h2>{group}</h2>
              {entries.map((item) => {
                const index = items.indexOf(item);
                return (
                  <button
                    key={item.id}
                    id={`${listId}-${item.id}`}
                    type="button"
                    role="option"
                    aria-selected={index === selectedIndex}
                    tabIndex={-1}
                    onMouseMove={() => setActiveIndex(index)}
                    onClick={() => run(item)}
                  >
                    {item.icon}
                    <span>
                      <strong>{item.label}</strong>
                      {item.detail && <small>{item.detail}</small>}
                    </span>
                  </button>
                );
              })}
            </section>
          ))}
          {items.length === 0 && !searching && (
            <p className="command-empty">
              No matching tasks, notes, projects, or commands.
            </p>
          )}
          {(taskSearch.error || documents.error) && (
            <p className="command-error" role="alert">
              Some search results could not be loaded.
            </p>
          )}
        </div>
        <footer className="command-footer">
          <span>{searching ? 'Searching…' : `${items.length} results`}</span>
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> Navigate <kbd>Enter</kbd> Open
          </span>
        </footer>
      </div>
    </dialog>
  );
}

function groupItems(items: PaletteItem[]) {
  const groups: PaletteItem['group'][] = [
    'Navigate',
    'Projects',
    'Tasks',
    'Library',
  ];
  return groups
    .map(
      (group) => [group, items.filter((item) => item.group === group)] as const,
    )
    .filter(([, entries]) => entries.length > 0);
}
