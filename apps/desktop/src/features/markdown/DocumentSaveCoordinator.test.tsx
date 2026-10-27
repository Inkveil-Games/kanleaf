import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { DocumentSaveCoordinator } from './DocumentSaveCoordinator';
import {
  DocumentTransitionCancelledError,
  UnsavedDocumentError,
  useDocumentSaveCoordinator,
} from './documentSaveCoordinatorContext';

describe('DocumentSaveCoordinator', () => {
  it('flushes every mounted document barrier', async () => {
    const first = vi.fn().mockResolvedValue(undefined);
    const second = vi.fn().mockResolvedValue(undefined);
    render(
      <DocumentSaveCoordinator>
        <RegisteredSave save={first} />
        <RegisteredSave save={second} />
        <FlushControl />
      </DocumentSaveCoordinator>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Flush documents' }));

    expect(await screen.findByText('flushed')).toBeInTheDocument();
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
  });

  it('blocks the transition when a mounted document cannot save', async () => {
    const save = vi.fn().mockRejectedValue(new Error('Revision conflict'));
    render(
      <DocumentSaveCoordinator>
        <RegisteredSave save={save} />
        <FlushControl />
      </DocumentSaveCoordinator>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Flush documents' }));

    expect(await screen.findByText('Revision conflict')).toBeInTheDocument();
  });

  it('lets the person retry an unsaved document before leaving', async () => {
    const retry = vi.fn().mockResolvedValue(true);
    const save = vi
      .fn()
      .mockRejectedValue(
        new UnsavedDocumentError(
          'error',
          'Server unavailable',
          '# Draft',
          retry,
          vi.fn(),
        ),
      );
    renderBarrier(save);

    fireEvent.click(screen.getByRole('button', { name: 'Flush documents' }));
    const dialog = await screen.findByRole('alertdialog', {
      name: 'This note has unsaved changes',
    });
    expect(dialog).toHaveTextContent('Server unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Try saving again' }));

    expect(await screen.findByText('flushed')).toBeInTheDocument();
    expect(retry).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(),
    );
  });

  it('keeps the document open without an error message when staying', async () => {
    const save = vi
      .fn()
      .mockRejectedValue(
        new UnsavedDocumentError('error', '', '# Draft', vi.fn(), vi.fn()),
      );
    renderBarrier(save);

    fireEvent.click(screen.getByRole('button', { name: 'Flush documents' }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Stay on note' }),
    );

    await waitFor(() =>
      expect(screen.getByTestId('flush-result')).toHaveTextContent('cancelled'),
    );
  });

  it('discards a conflicted draft only after the person confirms', async () => {
    const discard = vi.fn().mockResolvedValue(undefined);
    const save = vi
      .fn()
      .mockRejectedValue(
        new UnsavedDocumentError('conflict', '', '# Draft', vi.fn(), discard),
      );
    renderBarrier(save);

    fireEvent.click(screen.getByRole('button', { name: 'Flush documents' }));
    expect(
      await screen.findByRole('alertdialog', {
        name: 'This note changed outside Kanleaf',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Copy draft' }),
    ).toBeInTheDocument();
    expect(discard).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Discard my draft' }));

    expect(await screen.findByText('flushed')).toBeInTheDocument();
    expect(discard).toHaveBeenCalledOnce();
  });

  it('unregisters a document after it unmounts', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <DocumentSaveCoordinator>
        <RegisteredSave save={save} />
        <FlushControl />
      </DocumentSaveCoordinator>,
    );
    rerender(
      <DocumentSaveCoordinator>
        <FlushControl />
      </DocumentSaveCoordinator>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Flush documents' }));
    await waitFor(() =>
      expect(screen.getByText('flushed')).toBeInTheDocument(),
    );
    expect(save).not.toHaveBeenCalled();
  });
});

function renderBarrier(save: () => Promise<void>) {
  render(
    <DocumentSaveCoordinator>
      <RegisteredSave save={save} />
      <FlushControl />
    </DocumentSaveCoordinator>,
  );
}

function RegisteredSave({ save }: { save: () => Promise<void> }) {
  const { registerDocumentSave } = useDocumentSaveCoordinator();
  useEffect(() => registerDocumentSave(save), [registerDocumentSave, save]);
  return null;
}

function FlushControl() {
  const { flushDocumentSaves } = useDocumentSaveCoordinator();
  const [result, setResult] = useState('idle');
  return (
    <>
      <button
        type="button"
        onClick={() => {
          void flushDocumentSaves()
            .then(() => setResult('flushed'))
            .catch((error: Error) =>
              setResult(
                error instanceof DocumentTransitionCancelledError
                  ? 'cancelled'
                  : error.message,
              ),
            );
        }}
      >
        Flush documents
      </button>
      <span data-testid="flush-result">{result}</span>
    </>
  );
}
