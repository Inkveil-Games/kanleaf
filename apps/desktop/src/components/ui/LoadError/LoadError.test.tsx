import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LoadError } from './LoadError';

describe('LoadError', () => {
  it('announces feature-owned error content and retries by keyboard', async () => {
    const user = userEvent.setup();
    const retry = vi.fn();
    const { rerender } = render(
      <LoadError
        title="Could not load Tasks"
        description="Server unavailable"
        onRetry={retry}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Server unavailable');
    await user.tab();
    expect(screen.getByRole('button', { name: 'Try again' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(retry).toHaveBeenCalledOnce();

    rerender(
      <LoadError title="Could not load Tasks" onRetry={retry} retrying />,
    );
    expect(screen.getByRole('button', { name: 'Trying again' })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Trying again' }),
    ).toHaveAttribute('aria-busy', 'true');
    await user.click(screen.getByRole('button', { name: 'Trying again' }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
