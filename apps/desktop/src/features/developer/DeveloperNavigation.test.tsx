import { createRef } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { DeveloperNavigation } from './DeveloperNavigation';

describe('DeveloperNavigation', () => {
  it('shows rail hints by keyboard while retaining link navigation', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(
      <MemoryRouter>
        <DeveloperNavigation
          workspace={{
            id: 'workspace-1',
            identifier: 'kanleaf',
            name: 'Kanleaf',
            role: 'owner',
            accent: 'sage',
            created_at: '',
            updated_at: '',
          }}
          section="overview"
          mode="rail"
          accountControl={null}
          workspaceControl={null}
          narrow={false}
          drawerOpen={false}
          toggleRef={createRef<HTMLButtonElement>()}
          onToggle={vi.fn()}
          onNavigate={onNavigate}
        />
      </MemoryRouter>,
    );
    await user.tab();
    expect(
      screen.getByRole('button', { name: 'Expand navigation' }),
    ).toHaveFocus();
    await user.tab();
    const overview = screen.getByRole('link', { name: 'Overview' });
    expect(overview).toHaveFocus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Overview');
    expect(overview).toHaveAttribute('href', '/developer/w/kanleaf');
    expect(overview).not.toHaveAttribute('title');
    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument(),
    );
    expect(overview).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onNavigate).toHaveBeenCalledOnce();
  });
});
