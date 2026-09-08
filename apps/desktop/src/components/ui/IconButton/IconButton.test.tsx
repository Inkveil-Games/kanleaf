import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { X } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import { IconButton } from './IconButton';

describe('IconButton', () => {
  it('requires an accessible name and delegates interaction to Button', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();

    render(
      <IconButton aria-label="Close" onClick={onClick}>
        <X aria-hidden="true" />
      </IconButton>,
    );

    const button = screen.getByRole('button', { name: 'Close' });
    expect(button).toHaveAttribute('data-variant', 'ghost');
    expect(button).toHaveAttribute('data-size', 'sm');

    await user.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });
});
