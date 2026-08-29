import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { DocumentSaveCoordinator } from './DocumentSaveCoordinator';
import { useDocumentSaveCoordinator } from './documentSaveCoordinatorContext';

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
            .catch((error: Error) => setResult(error.message));
        }}
      >
        Flush documents
      </button>
      <span>{result}</span>
    </>
  );
}
