import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button } from '../Button';
import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
  it('announces the empty collection and exposes its available action', async () => {
    const user = userEvent.setup();
    const create = vi.fn();
    render(
      <EmptyState
        title="No Projects yet"
        description="Create a Project to organize work."
        action={<Button onClick={create}>Create Project</Button>}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent('No Projects yet');
    expect(screen.getByRole('status')).toHaveTextContent(
      'Create a Project to organize work.',
    );
    await user.click(screen.getByRole('button', { name: 'Create Project' }));
    expect(create).toHaveBeenCalledOnce();
  });

  it('offers no action when the caller has none', () => {
    render(<EmptyState title="No Projects yet" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
