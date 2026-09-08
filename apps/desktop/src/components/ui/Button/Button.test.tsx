import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button';

describe('Button', () => {
  it.each(['primary', 'secondary', 'ghost', 'text', 'danger'] as const)(
    'renders the %s variant',
    (variant) => {
      render(<Button variant={variant}>Action</Button>);
      expect(screen.getByRole('button', { name: 'Action' })).toHaveAttribute(
        'data-variant',
        variant,
      );
    },
  );

  it('renders the requested variant and size and forwards button behavior', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const ref = createRef<HTMLButtonElement>();

    render(
      <Button ref={ref} variant="danger" size="sm" onClick={onClick}>
        Delete
      </Button>,
    );

    const button = screen.getByRole('button', { name: 'Delete' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveAttribute('data-variant', 'danger');
    expect(button).toHaveAttribute('data-size', 'sm');
    expect(ref.current).toBe(button);

    await user.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('locks interaction and exposes a stable busy state while loading', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();

    render(
      <Button loading onClick={onClick}>
        Save changes
      </Button>,
    );

    const button = screen.getByRole('button', { name: 'Save changes' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveTextContent('Save changes');

    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('can announce a more specific loading label', () => {
    render(
      <Button loading loadingLabel="Saving changes">
        Save
      </Button>,
    );
    expect(
      screen.getByRole('button', { name: 'Saving changes' }),
    ).toHaveAttribute('aria-busy', 'true');
  });

  it('preserves an explicitly disabled state', () => {
    render(<Button disabled>Unavailable</Button>);
    expect(screen.getByRole('button', { name: 'Unavailable' })).toBeDisabled();
  });
});
