import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AppDialog } from './AppDialog';

function ConfirmHarness({
  onConfirm = vi.fn(),
}: {
  onConfirm?: () => boolean | void | Promise<boolean | void>;
}) {
  const [open, setOpen] = useState(true);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Reopen
      </button>
      <AppDialog
        open={open}
        onOpenChange={setOpen}
        type="confirm"
        variant="danger"
        title="Delete label?"
        description="Tasks will keep their other labels."
        confirmLabel="Delete"
        onConfirm={onConfirm}
      >
        <span>Custom consequence</span>
      </AppDialog>
    </>
  );
}

describe('AppDialog', () => {
  it('renders a confirm dialog and supports cancel and confirm actions', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<ConfirmHarness onConfirm={onConfirm} />);

    const dialog = screen.getByRole('alertdialog', {
      name: 'Delete label?',
    });
    expect(dialog).toHaveTextContent('Tasks will keep their other labels.');
    expect(dialog).toHaveTextContent('Custom consequence');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(),
    );

    await user.click(screen.getByRole('button', { name: 'Reopen' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(),
    );
  });

  it('renders an alert with one close action', async () => {
    const user = userEvent.setup();
    function AlertHarness() {
      const [open, setOpen] = useState(true);
      return (
        <AppDialog
          open={open}
          onOpenChange={setOpen}
          type="alert"
          variant="info"
          title="Import finished"
          description="The Workspace is ready."
          closeLabel="Got it"
        />
      );
    }

    render(<AlertHarness />);
    expect(
      screen.getByRole('alertdialog', { name: 'Import finished' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Cancel' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Confirm' }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Got it' }));
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(),
    );
  });

  it('gates typed confirmation, supports case-insensitive matching, and resets', async () => {
    const user = userEvent.setup();
    function TypedHarness() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Reopen typed
          </button>
          <AppDialog
            open={open}
            onOpenChange={setOpen}
            type="typed-confirm"
            variant="danger"
            title="Delete Workspace?"
            confirmationText="Kanleaf-Team"
            confirmationLabel={
              <>
                Type <strong>Kanleaf-Team</strong> to confirm
              </>
            }
            confirmationCaseSensitive={false}
            confirmLabel="Delete Workspace"
            onConfirm={vi.fn()}
          />
        </>
      );
    }

    render(<TypedHarness />);
    const confirm = screen.getByRole('button', { name: 'Delete Workspace' });
    const input = screen.getByRole('textbox', {
      name: 'Type Kanleaf-Team to confirm',
    });
    expect(confirm).toBeDisabled();
    await user.type(input, 'wrong');
    expect(confirm).toBeDisabled();
    await user.clear(input);
    await user.type(input, 'kanleaf-team');
    expect(confirm).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Reopen typed' }));
    expect(
      screen.getByRole('textbox', { name: 'Type Kanleaf-Team to confirm' }),
    ).toHaveValue('');
  });

  it('defaults typed confirmation to case-sensitive matching', async () => {
    const user = userEvent.setup();
    render(
      <AppDialog
        open
        onOpenChange={vi.fn()}
        type="typed-confirm"
        title="Delete Project?"
        confirmationText="Core"
        confirmLabel="Delete"
        onConfirm={vi.fn()}
      />,
    );

    await user.type(screen.getByRole('textbox'), 'core');
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
  });

  it('awaits async confirmation and prevents duplicate submission', async () => {
    const user = userEvent.setup();
    let resolve: (() => void) | undefined;
    const onConfirm = vi.fn(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    render(<ConfirmHarness onConfirm={onConfirm} />);

    const confirm = screen.getByRole('button', { name: 'Delete' });
    await user.click(confirm);
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveTextContent('Working…');
    await user.click(confirm);
    expect(onConfirm).toHaveBeenCalledOnce();

    resolve?.();
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(),
    );
  });

  it('keeps the dialog open and announces rejected confirmations', async () => {
    const user = userEvent.setup();
    render(
      <ConfirmHarness
        onConfirm={() => Promise.reject(new Error('Deletion failed'))}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Deletion failed',
    );
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeEnabled();
  });

  it('keeps the dialog open when confirmation is not ready to proceed', async () => {
    const user = userEvent.setup();
    render(<ConfirmHarness onConfirm={() => false} />);

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeEnabled();
  });

  it('renders custom children and submits a child form from the footer', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(
      <AppDialog
        open
        onOpenChange={vi.fn()}
        type="custom"
        title="Move task"
        formId="move-task-form"
        confirmLabel="Move"
      >
        <form id="move-task-form" onSubmit={onSubmit}>
          <label>
            Destination
            <input name="destination" required />
          </label>
        </form>
      </AppDialog>,
    );

    expect(
      screen.getByRole('dialog', { name: 'Move task' }),
    ).toBeInTheDocument();
    await user.type(
      screen.getByRole('textbox', { name: 'Destination' }),
      'Web',
    );
    await user.click(screen.getByRole('button', { name: 'Move' }));
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it('closes with Escape and restores focus to the previous control', async () => {
    const user = userEvent.setup();
    function EscapeHarness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open dialog
          </button>
          <AppDialog
            open={open}
            onOpenChange={setOpen}
            type="confirm"
            title="Archive note?"
            onConfirm={vi.fn()}
          />
        </>
      );
    }

    render(<EscapeHarness />);
    const trigger = screen.getByRole('button', { name: 'Open dialog' });
    await user.click(trigger);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    await user.keyboard('[Escape]');

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    });
  });
});
