import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from './ToastProvider';
import { useToast, type ToastVariant } from './useToast';

function Example({ onRetry = () => undefined }: { onRetry?: () => void }) {
  const { show } = useToast();
  return (
    <>
      {(['success', 'info', 'warning', 'danger'] as ToastVariant[]).map(
        (variant) => (
          <button
            key={variant}
            onClick={() => show({ title: `${variant} message`, variant })}
          >
            Show {variant}
          </button>
        ),
      )}
      <button
        onClick={() =>
          show({
            title: 'Could not save',
            description: 'Your draft is still available.',
            variant: 'danger',
            action: { label: 'Try again', onClick: onRetry },
          })
        }
      >
        Fail
      </button>
    </>
  );
}

afterEach(() => vi.useRealTimers());

describe('Toast', () => {
  it('announces an error and exposes retry and dismissal to keyboard users', async () => {
    const retry = vi.fn();
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <Example onRetry={retry} />
      </ToastProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Fail' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save');
    await user.keyboard('{F6}');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
    await user.click(
      screen.getByRole('button', { name: 'Dismiss notification' }),
    );
    await waitFor(() =>
      expect(screen.queryAllByText('Could not save')).toHaveLength(0),
    );
  });

  it('auto-dismisses success and info, while warning and error remain', async () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <Example />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Show success' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show info' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    const viewport = within(
      screen.getByRole('region', { name: 'Status messages' }),
    );
    expect(viewport.queryByText('success message')).not.toBeInTheDocument();
    expect(viewport.queryByText('info message')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show warning' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show danger' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(viewport.getByText('warning message')).toBeVisible();
    expect(viewport.getByText('danger message')).toBeVisible();
  });
});
