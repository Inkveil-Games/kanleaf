import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocumentSaveCoordinator } from './DocumentSaveCoordinator';
import { MarkdownDocument } from './MarkdownDocument';

vi.mock('@uiw/react-codemirror', () => ({
  default: (props: {
    value: string;
    onChange: (value: string) => void;
    'aria-label'?: string;
  }) => (
    <textarea
      aria-label={props['aria-label']}
      value={props.value}
      onChange={(event) => props.onChange(event.currentTarget.value)}
    />
  ),
}));

vi.mock('./MilkdownEditor', () => ({
  MilkdownEditor: (props: {
    value: string;
    onChange: (value: string) => void;
  }) => (
    <textarea
      aria-label="Visual Markdown editor"
      value={props.value}
      onChange={(event) => props.onChange(event.currentTarget.value)}
    />
  ),
}));

function response(content = '# Original', revision = 'a'.repeat(64)) {
  return new Response(JSON.stringify({ content, revision }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function renderDocument(
  fetchMock: ReturnType<typeof vi.fn>,
  options: { readOnly?: boolean; context?: ReactNode; targetId?: string } = {},
) {
  vi.stubGlobal('fetch', fetchMock);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <DocumentSaveCoordinator>
        <MarkdownDocument
          serverUrl="https://kanleaf.example.com"
          token="session-token"
          workspaceId="workspace-1"
          target={{ kind: 'task', id: options.targetId ?? 'task-1' }}
          readOnly={options.readOnly}
          documentContext={options.context}
        />
      </DocumentSaveCoordinator>
    </QueryClientProvider>,
  );
}

describe('MarkdownDocument', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses the shared load error and retries without opening a stale document', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('Server unavailable'))
      .mockResolvedValueOnce(response('# Recovered'));
    renderDocument(fetchMock);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Server unavailable',
    );
    expect(screen.queryByLabelText('Visual Markdown editor')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByLabelText('Visual Markdown editor')).toHaveValue(
      '# Recovered',
    );
    expect(screen.queryByRole('alert')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('switches editing modes with arrow keys without saving the document', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response());
    renderDocument(fetchMock);
    await screen.findByLabelText('Visual Markdown editor');
    const editor = screen.getByRole('button', { name: 'Editor' });
    editor.focus();
    fireEvent.keyDown(editor, { key: 'ArrowRight' });
    expect(await screen.findByLabelText('Markdown source')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Source' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Source' }), {
      key: 'ArrowLeft',
    });
    expect(
      await screen.findByLabelText('Visual Markdown editor'),
    ).toBeVisible();
    expect(
      fetchMock.mock.calls.some(([, options]) => options?.method === 'PUT'),
    ).toBe(false);
  });

  it('opens editable documents directly in the shared visual editor', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response('# Editor'));
    renderDocument(fetchMock, {
      context: <div aria-label="Task properties">Properties</div>,
    });

    const visual = await screen.findByLabelText('Visual Markdown editor');
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByText('Reading', { selector: 'span' })).toBeNull();
    expect(screen.getByLabelText('Task properties')).toAppearBefore(visual);
  });

  it('synchronizes one draft between the visual Editor and Source', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(response()));
    renderDocument(fetchMock);

    const visual = await screen.findByLabelText('Visual Markdown editor');
    fireEvent.change(visual, { target: { value: '# Shared draft' } });
    expect(screen.getByText('Unsaved')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Source' }));
    expect(
      await screen.findByLabelText('Markdown source', undefined, {
        timeout: 3_000,
      }),
    ).toHaveValue('# Shared draft');

    fireEvent.change(screen.getByLabelText('Markdown source'), {
      target: { value: '# Source draft' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Editor' }));
    expect(await screen.findByLabelText('Visual Markdown editor')).toHaveValue(
      '# Source draft',
    );
  });

  it('does not persist merely because the editing tab changes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response());
    renderDocument(fetchMock);

    await screen.findByLabelText('Visual Markdown editor');
    fireEvent.click(screen.getByRole('button', { name: 'Source' }));
    await screen.findByLabelText('Markdown source', undefined, {
      timeout: 3_000,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Editor' }));
    await screen.findByLabelText('Visual Markdown editor');

    expect(
      fetchMock.mock.calls.some(([, options]) => options?.method === 'PUT'),
    ).toBe(false);
  });

  it('autosaves the shared draft after the debounce interval', async () => {
    const fetchMock = vi.fn((_url: string, options?: RequestInit) =>
      Promise.resolve(
        options?.method === 'PUT'
          ? response('# Autosaved draft', 'b'.repeat(64))
          : response(),
      ),
    );
    renderDocument(fetchMock);
    fireEvent.change(await screen.findByLabelText('Visual Markdown editor'), {
      target: { value: '# Autosaved draft' },
    });

    await waitFor(
      () =>
        expect(fetchMock).toHaveBeenLastCalledWith(
          'https://kanleaf.example.com/api/workspaces/workspace-1/tasks/task-1/document',
          expect.objectContaining({
            method: 'PUT',
            body: expect.stringContaining('# Autosaved draft'),
          }),
        ),
      { timeout: 2_000 },
    );
    expect(screen.getByText('Saved')).toBeInTheDocument();
    expect(screen.getByLabelText('Visual Markdown editor')).toBeInTheDocument();
  });

  it('flushes a pending draft when the document closes before the debounce', async () => {
    const fetchMock = vi.fn((_url: string, options?: RequestInit) =>
      Promise.resolve(
        options?.method === 'PUT'
          ? response('# Closing draft', 'b'.repeat(64))
          : response(),
      ),
    );
    const view = renderDocument(fetchMock);
    fireEvent.change(await screen.findByLabelText('Visual Markdown editor'), {
      target: { value: '# Closing draft' },
    });

    view.unmount();

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        'https://kanleaf.example.com/api/workspaces/workspace-1/tasks/task-1/document',
        expect.objectContaining({
          method: 'PUT',
          body: expect.stringContaining('# Closing draft'),
        }),
      ),
    );
  });

  it('handles Ctrl/Cmd+S without leaving the edit session', async () => {
    const fetchMock = vi.fn((_url: string, options?: RequestInit) =>
      Promise.resolve(
        options?.method === 'PUT' ? response('# Shortcut') : response(),
      ),
    );
    renderDocument(fetchMock);
    fireEvent.change(await screen.findByLabelText('Visual Markdown editor'), {
      target: { value: '# Shortcut' },
    });
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });

    await waitFor(() => expect(screen.getByText('Saved')).toBeInTheDocument());
    expect(screen.getByLabelText('Visual Markdown editor')).toBeInTheDocument();
  });

  it('keeps read-only documents readable without exposing editor controls', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response('- [ ] Viewer'));
    renderDocument(fetchMock, { readOnly: true });

    expect(await screen.findByText('Read only')).toBeInTheDocument();
    expect(screen.queryByLabelText('Visual Markdown editor')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Editor' })).toBeNull();
    expect(screen.getByRole('checkbox')).toBeDisabled();
  });

  it('keeps the local draft open on a revision conflict', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const fetchMock = vi.fn((_url: string, options?: RequestInit) =>
      Promise.resolve(
        options?.method === 'PUT'
          ? new Response(
              JSON.stringify({
                error: { code: 'conflict', message: 'Changed externally' },
              }),
              { status: 409, headers: { 'content-type': 'application/json' } },
            )
          : response(),
      ),
    );
    renderDocument(fetchMock);
    fireEvent.change(await screen.findByLabelText('Visual Markdown editor'), {
      target: { value: '# Local draft' },
    });
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });

    expect(await screen.findByText('Conflict')).toBeInTheDocument();
    expect(screen.getByLabelText('Visual Markdown editor')).toHaveValue(
      '# Local draft',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Copy local' }));
    expect(await screen.findByText('Local source copied')).toBeVisible();
    expect(writeText).toHaveBeenCalledExactlyOnceWith('# Local draft');
    expect(screen.getByText('Conflict')).toBeInTheDocument();
  });

  it('falls back to Source when visual round-trip safety is unknown', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(response('<details>Keep</details>'));
    renderDocument(fetchMock);

    expect(
      await screen.findByLabelText('Markdown source', undefined, {
        timeout: 3_000,
      }),
    ).toHaveValue('<details>Keep</details>');
    expect(screen.getByRole('button', { name: 'Editor' })).toBeDisabled();
    expect(screen.getByText(/Raw HTML is safest/)).toBeInTheDocument();
  });
});
