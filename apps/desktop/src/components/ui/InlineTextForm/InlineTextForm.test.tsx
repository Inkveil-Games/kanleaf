import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { InlineTextForm } from './InlineTextForm';

describe('InlineTextForm', () => {
  it('supports a visible cancel action and hints without submitting an empty draft', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const onSubmit = vi.fn();
    render(
      <InlineTextForm
        label="Task title"
        maxLength={300}
        submitLabel="Add"
        cancelContent="Cancel"
        hint="Enter to add"
        onSubmit={onSubmit}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
    await user.type(screen.getByRole('textbox'), 'Draft task');
    expect(screen.getByRole('button', { name: 'Add' })).toBeEnabled();
    expect(screen.getByText('Enter to add')).toBeVisible();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('keeps a pending draft open and submits it only once', async () => {
    const user = userEvent.setup();
    let rejectSubmit: (error: Error) => void = () => undefined;
    const onSubmit = vi.fn(
      () =>
        new Promise<void>((_, reject) => {
          rejectSubmit = reject;
        }),
    );
    const onCancel = vi.fn();
    render(
      <InlineTextForm
        maxLength={300}
        label="Note title"
        initialValue="Research"
        submitLabel="Create note"
        onSubmit={onSubmit}
        onCancel={onCancel}
      />,
    );
    const input = screen.getByRole('textbox', { name: 'Note title' });
    const form = input.closest('form');
    if (!form) throw new Error('Expected inline form');

    fireEvent.submit(form);
    fireEvent.submit(form);
    fireEvent.keyDown(input, { key: 'Escape' });
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith('Research');
    expect(onCancel).not.toHaveBeenCalled();
    expect(input).toHaveAttribute('readonly');
    await act(async () => rejectSubmit(new Error('Name already exists')));
    expect(screen.getByRole('alert')).toHaveTextContent('Name already exists');
    expect(input).toHaveValue('Research');
    expect(input).toHaveAccessibleDescription('Name already exists');
    expect(input).not.toHaveAttribute('readonly');
    await user.click(input);
    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('keeps keyboard focus in a read-only pending draft and restores editing after rejection', async () => {
    const user = userEvent.setup();
    let rejectSubmit: (error: Error) => void = () => undefined;
    render(
      <InlineTextForm
        label="Note title"
        initialValue="Research"
        maxLength={300}
        submitLabel="Create note"
        onSubmit={() =>
          new Promise<void>((_, reject) => {
            rejectSubmit = reject;
          })
        }
        onCancel={vi.fn()}
      />,
    );
    const input = screen.getByRole('textbox', { name: 'Note title' });
    await user.keyboard('{Enter}');
    expect(input).toHaveFocus();
    expect(input).toBeEnabled();
    expect(input).toHaveAttribute('readonly');
    await user.keyboard(' pending');
    expect(input).toHaveValue('Research');
    await act(async () => rejectSubmit(new Error('Try again')));
    expect(input).toHaveFocus();
    expect(input).not.toHaveAttribute('readonly');
    await user.keyboard('{End} notes');
    expect(input).toHaveValue('Research notes');
  });

  it('keeps composition Enter and Escape inside the draft', () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onCancel = vi.fn();
    render(
      <InlineTextForm
        maxLength={300}
        label="Note title"
        submitLabel="Create note"
        onSubmit={onSubmit}
        onCancel={onCancel}
      />,
    );
    const input = screen.getByRole('textbox', { name: 'Note title' });
    fireEvent.change(input, { target: { value: '研究' } });
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: 'Escape', isComposing: true });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    const form = input.closest('form');
    if (!form) throw new Error('Expected inline form');
    fireEvent.submit(form);
    expect(onCancel).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('retains a rejected draft, announces the fallback error, and retries the edited value', async () => {
    const user = userEvent.setup();
    const onSubmit = vi
      .fn()
      .mockRejectedValueOnce('offline')
      .mockResolvedValue(undefined);
    render(
      <InlineTextForm
        label="Task title"
        initialValue="Research"
        maxLength={300}
        submitLabel="Add"
        loadingLabel="Adding Task"
        errorLabel="Task creation failed"
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    const input = screen.getByRole('textbox', { name: 'Task title' });
    expect(input).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Task creation failed',
    );
    expect(input).toHaveValue('Research');
    expect(input).toHaveAccessibleDescription('Task creation failed');
    await user.clear(input);
    await user.type(input, 'Research notes{Enter}');
    expect(onSubmit).toHaveBeenLastCalledWith('Research notes');
    await waitFor(() =>
      expect(screen.queryByRole('alert')).not.toBeInTheDocument(),
    );
    expect(input).toBeEnabled();
  });

  it('rejects whitespace-only drafts and enforces the caller length limit', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <InlineTextForm
        label="Name"
        maxLength={5}
        submitLabel="Add"
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    const input = screen.getByRole('textbox', { name: 'Name' });
    await user.type(input, '   {Enter}');
    expect(onSubmit).not.toHaveBeenCalled();
    await user.clear(input);
    await user.type(input, 'abcdef');
    expect(input).toHaveValue('abcde');
  });

  it('blocks submit and cancel keys reported as native IME composition', () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onCancel = vi.fn();
    render(
      <InlineTextForm
        label="Name"
        initialValue="研究"
        maxLength={120}
        submitLabel="Add"
        onSubmit={onSubmit}
        onCancel={onCancel}
      />,
    );
    const input = screen.getByRole('textbox', { name: 'Name' });
    expect(fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 })).toBe(
      false,
    );
    fireEvent.keyDown(input, { key: 'Escape', isComposing: true });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });
});
