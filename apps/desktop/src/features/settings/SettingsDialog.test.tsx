import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AppDialog, type AppDialogType } from '../../components/ui/AppDialog';
import {
  DropdownMenu,
  DropdownMenuItem,
} from '../../components/ui/DropdownMenu';
import { Popover } from '../../components/ui/Popover';
import { Select } from '../../components/ui/Select';
import { SettingsDialog } from './SettingsDialog';
import { SettingsFrame, SettingsGroup, SettingsLink } from './SettingsShell';

function NestedDialogHarness({ type }: { type: AppDialogType }) {
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setSettingsOpen(true)}>
        Reopen settings
      </button>
      {settingsOpen ? (
        <SettingsDialog
          label="Workspace settings"
          onClose={() => setSettingsOpen(false)}
        >
          <SettingsFrame
            label="Workspace settings"
            title="Kanleaf Core"
            backLabel="Back to Workspace"
            onBack={() => setSettingsOpen(false)}
            navigation={
              <SettingsGroup label="General">
                <SettingsLink
                  active
                  icon={null}
                  label="General"
                  onClick={vi.fn()}
                />
              </SettingsGroup>
            }
          >
            <button type="button" onClick={() => setDialogOpen(true)}>
              Open nested dialog
            </button>
            {type === 'alert' ? (
              <AppDialog
                open={dialogOpen}
                onOpenChange={setDialogOpen}
                type="alert"
                title="Nested action"
                closeLabel="Close"
              />
            ) : type === 'typed-confirm' ? (
              <AppDialog
                open={dialogOpen}
                onOpenChange={setDialogOpen}
                type="typed-confirm"
                title="Nested action"
                confirmationText="Kanleaf Core"
                confirmLabel="Delete"
                onConfirm={vi.fn()}
              />
            ) : type === 'custom' ? (
              <AppDialog
                open={dialogOpen}
                onOpenChange={setDialogOpen}
                type="custom"
                title="Nested action"
              >
                <input aria-label="Custom field" />
              </AppDialog>
            ) : (
              <AppDialog
                open={dialogOpen}
                onOpenChange={setDialogOpen}
                type="confirm"
                title="Nested action"
                confirmLabel="Continue"
                onConfirm={vi.fn()}
              />
            )}
          </SettingsFrame>
        </SettingsDialog>
      ) : null}
    </>
  );
}

describe('SettingsDialog', () => {
  it.each<AppDialogType>(['alert', 'confirm', 'typed-confirm', 'custom'])(
    'keeps a nested %s AppDialog above Settings and closes it first',
    async (type) => {
      const user = userEvent.setup();
      render(<NestedDialogHarness type={type} />);

      const settings = screen.getByRole('dialog', {
        name: 'Workspace settings',
      });
      expect(settings.tagName).toBe('DIV');

      const trigger = screen.getByRole('button', {
        name: 'Open nested dialog',
      });
      await user.click(trigger);

      const nested = screen.getByRole(
        type === 'custom' ? 'dialog' : 'alertdialog',
        { name: 'Nested action' },
      );
      expect(
        document.querySelector('.settings-dialog-backdrop'),
      ).not.toBeNull();
      expect(document.querySelector('.settings-dialog-popup')).not.toBeNull();
      expect(document.querySelector('.app-dialog-backdrop')).not.toBeNull();
      await waitFor(() =>
        expect(nested).toContainElement(document.activeElement as HTMLElement),
      );

      await user.keyboard('[Escape]');

      await waitFor(() => {
        expect(
          screen.queryByRole(type === 'custom' ? 'dialog' : 'alertdialog', {
            name: 'Nested action',
          }),
        ).not.toBeInTheDocument();
        expect(
          screen.getByRole('dialog', { name: 'Workspace settings' }),
        ).toBeInTheDocument();
        expect(trigger).toHaveFocus();
      });
    },
  );

  it('closes Settings without dismissing it twice', async () => {
    const user = userEvent.setup();
    render(<NestedDialogHarness type="confirm" />);

    await user.click(screen.getByRole('button', { name: 'Back to Workspace' }));
    expect(
      screen.queryByRole('dialog', { name: 'Workspace settings' }),
    ).not.toBeInTheDocument();
  });

  it('closes with Escape and restores focus outside Settings', async () => {
    const user = userEvent.setup();

    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open settings
          </button>
          {open ? (
            <SettingsDialog
              label="Account settings"
              onClose={() => setOpen(false)}
            >
              <button type="button">Settings control</button>
            </SettingsDialog>
          ) : null}
        </>
      );
    }

    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Open settings' });
    await user.click(trigger);
    expect(
      screen.getByRole('dialog', { name: 'Account settings' }),
    ).toBeInTheDocument();

    await user.keyboard('[Escape]');

    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: 'Account settings' }),
      ).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    });
  });

  it('keeps Select inside the active Settings layer', async () => {
    const user = userEvent.setup();
    render(
      <SettingsDialog label="Workspace settings" onClose={vi.fn()}>
        <Select
          ariaLabel="State group"
          value="todo"
          options={[
            { value: 'todo', label: 'Todo' },
            { value: 'started', label: 'In progress' },
          ]}
          onValueChange={vi.fn()}
        />
      </SettingsDialog>,
    );

    await user.click(screen.getByRole('combobox', { name: 'State group' }));

    expect(
      (await screen.findByRole('listbox')).closest(
        '[data-ui-portal-container]',
      ),
    ).toHaveClass('settings-dialog-popup');
  });

  it('keeps DropdownMenu inside the active Settings layer', async () => {
    const user = userEvent.setup();
    render(
      <SettingsDialog label="Workspace settings" onClose={vi.fn()}>
        <DropdownMenu label="Item actions">
          <DropdownMenuItem onClick={vi.fn()}>Rename</DropdownMenuItem>
        </DropdownMenu>
      </SettingsDialog>,
    );

    screen.getByRole('button', { name: 'Item actions' }).focus();
    await user.keyboard('[ArrowDown]');
    await waitFor(() => {
      expect(screen.getByRole('menu')).toBeInTheDocument();
    });
    expect(
      screen.getByRole('menu').closest('[data-ui-portal-container]'),
    ).toHaveClass('settings-dialog-popup');
  });

  it('keeps Popover inside the active Settings layer', async () => {
    const user = userEvent.setup();
    render(
      <SettingsDialog label="Workspace settings" onClose={vi.fn()}>
        <Popover label="More information">
          <button type="button">Popover action</button>
        </Popover>
      </SettingsDialog>,
    );

    await user.click(screen.getByRole('button', { name: 'More information' }));
    expect(
      (await screen.findByRole('dialog', { name: 'More information' })).closest(
        '[data-ui-portal-container]',
      ),
    ).toHaveClass('settings-dialog-popup');
  });
});
