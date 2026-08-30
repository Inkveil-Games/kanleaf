import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocumentSaveCoordinator } from './DocumentSaveCoordinator';
import { useDocumentSaveCoordinator } from './documentSaveCoordinatorContext';
import { MarkdownDocument } from './MarkdownDocument';

vi.mock('@uiw/react-codemirror', () => ({
  default: (props: {
    value: string;
    onChange: (value: string) => void;
    editable?: boolean;
    'aria-label'?: string;
  }) => (
    <textarea
      aria-label={props['aria-label']}
      value={props.value}
      readOnly={props.editable === false}
      onChange={(event) => {
        if (props.editable !== false) props.onChange(event.target.value);
      }}
    />
  ),
}));

function renderDocument(
  fetchMock: ReturnType<typeof vi.fn>,
  readOnly = false,
  documentContext?: ReactNode,
) {
  vi.stubGlobal('fetch', fetchMock);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <DocumentSaveCoordinator>
        <MarkdownDocument
          serverUrl="https://kanleaf.example.com"
          token="session-token"
          workspaceId="workspace-1"
          target={{ kind: 'task', id: 'task-1' }}
          readOnly={readOnly}
          documentContext={documentContext}
        />
        <TransitionControl />
      </DocumentSaveCoordinator>
    </QueryClientProvider>,
  );
}

describe('MarkdownDocument', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps the view controls above document context and Markdown', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ content: '# Shell body', revision: 'a'.repeat(64) }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    renderDocument(
      fetchMock,
      false,
      <div aria-label="Task properties">Task properties</div>,
    );

    const editor = await screen.findByLabelText('Markdown source');
    const toolbar = screen
      .getByRole('button', { name: 'Live' })
      .closest('header');
    const context = screen.getByLabelText('Task properties');

    expect(toolbar).toAppearBefore(context);
    expect(context).toAppearBefore(editor);
  });

  it('previews the current source and saves it explicitly', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: string, options: RequestInit | undefined) =>
        Promise.resolve(
          options?.method === 'PUT'
            ? new Response(
                JSON.stringify({
                  content: '# Architecture',
                  revision: 'b'.repeat(64),
                }),
                {
                  status: 200,
                  headers: { 'content-type': 'application/json' },
                },
              )
            : new Response(
                JSON.stringify({
                  content: '# Original',
                  revision: 'a'.repeat(64),
                }),
                {
                  status: 200,
                  headers: { 'content-type': 'application/json' },
                },
              ),
        ),
      );
    renderDocument(fetchMock);

    const editor = await screen.findByLabelText('Markdown source');
    expect(screen.getByRole('button', { name: 'Live' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.change(editor, {
      target: {
        value:
          '# Architecture\n\n| Layer | Owner |\n| --- | --- |\n| Vault | Filesystem |',
      },
    });
    expect(screen.getByText('Unsaved')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reading' }));
    expect(
      screen.getByRole('heading', { name: 'Architecture' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('table')).toHaveTextContent('VaultFilesystem');

    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        'https://kanleaf.example.com/api/workspaces/workspace-1/tasks/task-1/document',
        expect.objectContaining({
          method: 'PUT',
          body: expect.stringContaining('# Architecture'),
        }),
      ),
    );
    expect(await screen.findByText('Saved')).toBeInTheDocument();
  });

  it('debounces autosave after source changes', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: string, options: RequestInit | undefined) =>
        Promise.resolve(
          options?.method === 'PUT'
            ? new Response(
                JSON.stringify({
                  content: '# Autosaved note',
                  revision: 'b'.repeat(64),
                }),
                {
                  status: 200,
                  headers: { 'content-type': 'application/json' },
                },
              )
            : new Response(
                JSON.stringify({ content: '', revision: 'a'.repeat(64) }),
                {
                  status: 200,
                  headers: { 'content-type': 'application/json' },
                },
              ),
        ),
      );
    renderDocument(fetchMock);

    fireEvent.change(await screen.findByLabelText('Markdown source'), {
      target: { value: '# Autosaved note' },
    });

    await waitFor(
      () =>
        expect(fetchMock).toHaveBeenCalledWith(
          'https://kanleaf.example.com/api/workspaces/workspace-1/tasks/task-1/document',
          expect.objectContaining({ method: 'PUT' }),
        ),
      { timeout: 2_000 },
    );
    expect(await screen.findByText('Saved')).toBeInTheDocument();
  });

  it('keeps Viewer documents readable without exposing save behavior', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          content: '# Readable note',
          revision: 'a'.repeat(64),
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );
    renderDocument(fetchMock, true);

    expect(await screen.findByText('Read only')).toBeInTheDocument();
    expect(screen.getByLabelText('Markdown source')).toHaveAttribute(
      'readonly',
    );
    expect(
      screen.queryByRole('button', { name: 'Save Markdown' }),
    ).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('preserves local source and reloads explicitly after a revision conflict', async () => {
    let reads = 0;
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: string, options: RequestInit | undefined) => {
        if (options?.method === 'PUT') {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                error: {
                  code: 'conflict',
                  message: 'The Markdown document changed after it was opened',
                },
              }),
              { status: 409, headers: { 'content-type': 'application/json' } },
            ),
          );
        }
        reads += 1;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              content: reads === 1 ? '# Local base' : '# Remote edit',
              revision: (reads === 1 ? 'a' : 'c').repeat(64),
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        );
      });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    renderDocument(fetchMock);

    const editor = await screen.findByLabelText('Markdown source');
    fireEvent.change(editor, { target: { value: '# Local unsaved edit' } });
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });

    expect(await screen.findByText('Conflict')).toBeInTheDocument();
    expect(editor).toHaveValue('# Local unsaved edit');
    fireEvent.click(screen.getByRole('button', { name: 'Copy local' }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith('# Local unsaved edit'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Discard local' }));
    await waitFor(() => expect(editor).toHaveValue('# Remote edit'));
    expect(screen.getByText('Saved')).toBeInTheDocument();
  });

  it('flushes pending source before an identity transition', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: string, options: RequestInit | undefined) =>
        Promise.resolve(
          options?.method === 'PUT'
            ? new Response(
                JSON.stringify({
                  content: '# Before switch',
                  revision: 'b'.repeat(64),
                }),
                {
                  status: 200,
                  headers: { 'content-type': 'application/json' },
                },
              )
            : new Response(
                JSON.stringify({ content: '', revision: 'a'.repeat(64) }),
                {
                  status: 200,
                  headers: { 'content-type': 'application/json' },
                },
              ),
        ),
      );
    renderDocument(fetchMock);

    fireEvent.change(await screen.findByLabelText('Markdown source'), {
      target: { value: '# Before switch' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Flush transition' }));

    expect(await screen.findByText('Transition ready')).toBeInTheDocument();
    expect(screen.getByText('Saved')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/document'),
      expect.objectContaining({ method: 'PUT' }),
    );
  });

  it('blocks transition after a save error and supports retry', async () => {
    let writes = 0;
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: string, options: RequestInit | undefined) => {
        if (options?.method === 'PUT') {
          writes += 1;
          return Promise.resolve(
            writes === 1
              ? new Response(
                  JSON.stringify({
                    error: { code: 'internal', message: 'Vault unavailable' },
                  }),
                  {
                    status: 500,
                    headers: { 'content-type': 'application/json' },
                  },
                )
              : new Response(
                  JSON.stringify({
                    content: '# Retry me',
                    revision: 'b'.repeat(64),
                  }),
                  {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                  },
                ),
          );
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({ content: '', revision: 'a'.repeat(64) }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        );
      });
    renderDocument(fetchMock);

    fireEvent.change(await screen.findByLabelText('Markdown source'), {
      target: { value: '# Retry me' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Flush transition' }));

    expect(
      await screen.findByText(
        'Resolve unsaved Markdown before switching accounts',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Markdown could not be saved.'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try save' }));
    expect(await screen.findByText('Saved')).toBeInTheDocument();
  });
});

function TransitionControl() {
  const { flushDocumentSaves } = useDocumentSaveCoordinator();
  const [message, setMessage] = useState('');
  return (
    <>
      <button
        type="button"
        onClick={() => {
          void flushDocumentSaves()
            .then(() => setMessage('Transition ready'))
            .catch((error: Error) => setMessage(error.message));
        }}
      >
        Flush transition
      </button>
      <span>{message}</span>
    </>
  );
}
