import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FormEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { FormActions } from './SettingsControls';

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
