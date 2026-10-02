import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { InlineAlert } from './InlineAlert';

describe('InlineAlert', () => {
  it('announces errors and offers keyboard-accessible retry and dismissal', async () => {
    const user = userEvent.setup();
    const retry = vi.fn();
    const dismiss = vi.fn();
    render(
      <InlineAlert
        variant="danger"
        title="Could not save"
        action={{ label: 'Try again', onClick: retry }}
        onDismiss={dismiss}
        dismissLabel="Dismiss save error"
      >
        Your draft is still available.
      </InlineAlert>,
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Could not save');
    expect(alert).toHaveTextContent('Your draft is still available.');
    await user.tab();
    expect(
      within(alert).getByRole('button', { name: 'Try again' }),
    ).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(retry).toHaveBeenCalledOnce();
    await user.tab();
    await user.keyboard('{Enter}');
    expect(dismiss).toHaveBeenCalledOnce();
  });

  it('announces non-error feedback politely and blocks a busy action', async () => {
    const user = userEvent.setup();
    const retry = vi.fn();
    render(
      <InlineAlert
        variant="warning"
        action={{ label: 'Reconnect', onClick: retry, loading: true }}
      >
        Connection interrupted
      </InlineAlert>,
    );

    expect(screen.getByRole('status')).toHaveTextContent(
      'Connection interrupted',
    );
    const button = screen.getByRole('button', { name: 'Reconnect' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    await user.click(button);
    expect(retry).not.toHaveBeenCalled();
  });
});
