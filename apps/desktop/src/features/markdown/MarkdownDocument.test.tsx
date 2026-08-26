import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
      onChange={(event) => props.onChange(event.target.value)}
    />
  ),
}));

function renderDocument(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('fetch', fetchMock);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MarkdownDocument
        serverUrl="https://kanleaf.example.com"
        token="session-token"
        workspaceId="workspace-1"
        taskId="task-1"
      />
    </QueryClientProvider>,
  );
}

describe('MarkdownDocument', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('previews the current source and saves it explicitly', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: string, options: RequestInit | undefined) =>
        Promise.resolve(
          options?.method === 'PUT'
            ? new Response(null, { status: 204 })
            : new Response(JSON.stringify({ content: '# Original' }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
              }),
        ),
      );
    renderDocument(fetchMock);

    const editor = await screen.findByLabelText('Markdown source');
    fireEvent.change(editor, {
      target: {
        value:
          '# Architecture\n\n| Layer | Owner |\n| --- | --- |\n| Vault | Filesystem |',
      },
    });
    expect(screen.getByText('Unsaved')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
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
            ? new Response(null, { status: 204 })
            : new Response(JSON.stringify({ content: '' }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
              }),
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
});
