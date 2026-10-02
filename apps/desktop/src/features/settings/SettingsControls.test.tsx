import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FormEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { FormActions, LoadError, SettingsToggleRow } from './SettingsControls';

describe('LoadError', () => {
  it('keeps the settings error readable while a retry is pending', async () => {
    const user = userEvent.setup();
    const retry = vi.fn();
    const { rerender } = render(
      <LoadError error={new Error('Server unavailable')} onRetry={retry} />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Could not load this setting',
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Server unavailable');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
    rerender(
      <LoadError
        error={new Error('Server unavailable')}
        onRetry={retry}
        retrying
      />,
    );
    expect(screen.getByRole('button', { name: 'Trying again' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Server unavailable');
  });
});

describe('FormActions', () => {
  it('submits through the shared primary Button', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((event: FormEvent) => event.preventDefault());

    render(
      <form onSubmit={onSubmit}>
        <FormActions state={{ status: 'idle' }} label="Save profile" />
      </form>,
    );

    const submit = screen.getByRole('button', { name: 'Save profile' });
    expect(submit).toHaveAttribute('data-variant', 'primary');
    expect(submit).toHaveAttribute('data-size', 'sm');

    await user.click(submit);
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it('keeps the action stable and locked while saving', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((event: FormEvent) => event.preventDefault());

    render(
      <form onSubmit={onSubmit}>
        <FormActions state={{ status: 'saving' }} label="Save profile" />
      </form>,
    );

    const submit = screen.getByRole('button', { name: 'Save profile' });
    expect(submit).toBeDisabled();
    expect(submit).toHaveAttribute('aria-busy', 'true');

    await user.click(submit);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('SettingsToggleRow', () => {
  it('exposes a labeled Switch and reports preference changes', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();

    render(
      <SettingsToggleRow
        label="Comments and replies"
        description="Notify when a watched Task receives a reply."
        checked={false}
        onCheckedChange={onCheckedChange}
      />,
    );

    const control = screen.getByRole('switch', {
      name: 'Comments and replies',
    });
    expect(control).not.toBeChecked();
    expect(control).toHaveAccessibleDescription(
      'Notify when a watched Task receives a reply.',
    );

    await user.click(control);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });
});
