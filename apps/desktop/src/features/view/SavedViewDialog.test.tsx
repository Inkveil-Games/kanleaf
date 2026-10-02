import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SavedViewDialog } from './SavedViewDialog';

describe('SavedViewDialog', () => {
  it('names the dialog, focuses Name, and returns focus after cancellation', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Create View</button>
          {open && (
            <SavedViewDialog
              title="Save View"
              initialName=""
              initialVisibility="personal"
              canShare
              submitLabel="Save"
              onClose={() => setOpen(false)}
              onSubmit={vi.fn()}
            />
          )}
        </>
      );
    }
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Create View' }));
    expect(
      screen.getByRole('dialog', { name: 'Save View' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveFocus();
    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Create View' })).toHaveFocus();
  });

  it('blocks duplicate save and dismissal until a failed save can be retried', async () => {
    const user = userEvent.setup();
    let rejectSubmit: (error: Error) => void = () => undefined;
    const onSubmit = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((_, reject) => {
            rejectSubmit = reject;
          }),
      )
      .mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(
      <SavedViewDialog
        title="Save View"
        initialName="Focus"
        initialVisibility="personal"
        canShare
        submitLabel="Save"
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    );
    const input = screen.getByRole('textbox', { name: 'Name' });
    const form = input.closest('form');
    if (!form) throw new Error('Expected View form');
    fireEvent.submit(form);
    fireEvent.submit(form);
    fireEvent.keyDown(input, { key: 'Escape' });
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    const viewport = screen.getByRole('dialog', {
      name: 'Save View',
    }).parentElement;
    if (!viewport) throw new Error('Expected dialog viewport');
    await user.click(viewport);
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith('Focus', 'personal');
    expect(onClose).not.toHaveBeenCalled();
    expect(input).toHaveAttribute('readonly');
    expect(screen.getByRole('radio', { name: /Shared/ })).toBeDisabled();
    await act(async () => rejectSubmit(new Error('View name already exists')));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'View name already exists',
    );
    expect(input).toHaveValue('Focus');
    await user.clear(input);
    await user.type(input, 'Delivery focus');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit).toHaveBeenLastCalledWith('Delivery focus', 'personal');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('retains Name focus and editing position through a pending and rejected save', async () => {
    const user = userEvent.setup();
    let rejectSubmit: (error: Error) => void = () => undefined;
    render(
      <SavedViewDialog
        title="Save View"
        initialName="Focus"
        initialVisibility="personal"
        canShare
        submitLabel="Save"
        onClose={vi.fn()}
        onSubmit={() =>
          new Promise<void>((_, reject) => {
            rejectSubmit = reject;
          })
        }
      />,
    );
    const input = screen.getByRole('textbox', { name: 'Name' });
    await waitFor(() => expect(input).toHaveFocus());
    const form = input.closest('form');
    if (!form) throw new Error('Expected View form');
    fireEvent.submit(form);
    expect(input).toHaveFocus();
    expect(input).toBeEnabled();
    expect(input).toHaveAttribute('readonly');
    await user.keyboard(' pending');
    expect(input).toHaveValue('Focus');
    await act(async () => rejectSubmit(new Error('Try again')));
    expect(input).toHaveFocus();
    expect(input).not.toHaveAttribute('readonly');
    await user.keyboard('{End} notes');
    expect(input).toHaveValue('Focus notes');
  });

  it('keeps composition keys inside Name and respects the sharing permission', () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(
      <SavedViewDialog
        title="Save View"
        initialName="Focus"
        initialVisibility="personal"
        canShare={false}
        submitLabel="Save"
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    );
    const input = screen.getByRole('textbox', { name: 'Name' });
    expect(screen.getByRole('radio', { name: /Shared/ })).toBeDisabled();
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: 'Escape', isComposing: true });
    expect(fireEvent.keyDown(input, { key: 'Enter', isComposing: true })).toBe(
      false,
    );
    const form = input.closest('form');
    if (!form) throw new Error('Expected View form');
    fireEvent.submit(form);
    expect(onClose).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
