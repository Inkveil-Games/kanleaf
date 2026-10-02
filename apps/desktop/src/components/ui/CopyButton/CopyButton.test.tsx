import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CopyButton } from './CopyButton';

function clipboard(writeText: (value: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
}

describe('CopyButton', () => {
  afterEach(() => vi.useRealTimers());

  it('copies once while pending, announces success, and resets feedback', async () => {
    vi.useFakeTimers();
    let resolveCopy: () => void = () => undefined;
    const writeText = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveCopy = resolve;
        }),
    );
    clipboard(writeText);
    render(
      <CopyButton
        text="secret"
        label="Copy token"
        successLabel="Token copied"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Copy token' }));
    const pending = screen.getByRole('button', { name: 'Copying…' });
    expect(pending).toBeDisabled();
    expect(pending).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(pending);
    expect(writeText).toHaveBeenCalledExactlyOnceWith('secret');
    await act(async () => resolveCopy());
    expect(screen.getByRole('status')).toHaveTextContent('Token copied');
    act(() => vi.advanceTimersByTime(3000));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy token' })).toBeEnabled();
  });

  it('announces failure and leaves source content available for manual copying and retry', async () => {
    clipboard(
      vi
        .fn()
        .mockRejectedValueOnce(new Error('Denied'))
        .mockResolvedValueOnce(undefined),
    );
    render(
      <>
        <input aria-label="Token" value="secret" readOnly />
        <CopyButton
          text="secret"
          label="Copy token"
          errorLabel="Select and copy the token manually"
        />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Copy token' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Select and copy the token manually',
    );
    expect(screen.getByRole('textbox', { name: 'Token' })).toHaveValue(
      'secret',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Copy token' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Copied');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('discards pending results and existing feedback when the text changes', async () => {
    let resolveFirst: () => void = () => undefined;
    const writeText = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    clipboard(writeText);
    const { rerender } = render(<CopyButton text="first" label="Copy token" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy token' }));
    rerender(<CopyButton text="second" label="Copy token" />);
    expect(screen.getByRole('button', { name: 'Copy token' })).toBeEnabled();
    await act(async () => resolveFirst());
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Copy token' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Copied');
    expect(writeText).toHaveBeenLastCalledWith('second');
    rerender(<CopyButton text="third" label="Copy token" />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
