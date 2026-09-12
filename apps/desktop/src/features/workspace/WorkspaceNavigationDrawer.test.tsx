import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { describe, expect, it } from 'vitest';
import { WorkspaceNavigationDrawer } from './WorkspaceNavigationDrawer';

describe('WorkspaceNavigationDrawer', () => {
  it('makes the overlaid navigation the only interactive tree', async () => {
    render(<DrawerHarness />);

    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));

    const drawer = await screen.findByRole('dialog', {
      name: 'Workspace navigation',
    });
    expect(within(drawer).getByRole('button', { name: 'Inbox' })).toBeVisible();
    expect(screen.getAllByRole('button', { name: 'Inbox' })).toHaveLength(1);
    expect(drawer.closest('[data-base-ui-portal]')).toHaveStyle({
      '--navigation-pane-width': '274px',
    });
  });

  it('closes from Escape and the scrim, then restores the rail', async () => {
    const user = userEvent.setup();
    render(<DrawerHarness />);
    const open = screen.getByRole('button', { name: 'Open navigation' });

    await user.click(open);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Workspace navigation' }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Inbox' })).toHaveTextContent(
      'Rail Inbox',
    );

    await user.click(open);
    await user.click(document.querySelector('.navigation-drawer-backdrop')!);
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Workspace navigation' }),
      ).not.toBeInTheDocument(),
    );
    expect(open).toHaveFocus();
  });
});

function DrawerHarness() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <aside aria-label="Workspace navigation rail">
        <button ref={triggerRef} type="button" onClick={() => setOpen(true)}>
          Open navigation
        </button>
        <button type="button" aria-label="Inbox">
          Rail Inbox
        </button>
      </aside>
      <WorkspaceNavigationDrawer
        navigationWidth={274}
        open={open}
        onOpenChange={setOpen}
        finalFocus={triggerRef}
      >
        <nav aria-label="Workspace">
          <button type="button" aria-label="Inbox">
            Drawer Inbox
          </button>
        </nav>
        <button type="button">Account</button>
      </WorkspaceNavigationDrawer>
    </>
  );
}
