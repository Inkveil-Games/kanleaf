import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Popover } from './Popover';

describe('Popover', () => {
  it('keeps interactive content open and dismisses on outside press', async () => {
    const user = userEvent.setup();
    const action = vi.fn();
    render(
      <div>
        <Popover label="Notifications">
          <button type="button" onClick={action}>
            Mark all read
          </button>
        </Popover>
        <button type="button">Outside</button>
      </div>,
    );

    await user.click(screen.getByRole('button', { name: 'Notifications' }));
    await user.click(screen.getByRole('button', { name: 'Mark all read' }));
    expect(action).toHaveBeenCalledOnce();
    expect(
      screen.getByRole('dialog', { name: 'Notifications' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Outside' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
  });

  it('dismisses with Escape and restores focus to the trigger', async () => {
    const user = userEvent.setup();
    render(
      <Popover label="Notifications">
        <button type="button">Mark all read</button>
      </Popover>,
    );

    const trigger = screen.getByRole('button', { name: 'Notifications' });
    await user.click(trigger);
    await user.keyboard('[Escape]');

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    });
  });
});
