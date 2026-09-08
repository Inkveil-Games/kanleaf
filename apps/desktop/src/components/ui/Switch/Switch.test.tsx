import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Switch } from './Switch';

function SwitchHarness() {
  const [checked, setChecked] = useState(false);
  return (
    <Switch
      aria-label="Email notifications"
      checked={checked}
      onCheckedChange={setChecked}
    />
  );
}

describe('Switch', () => {
  it('supports pointer and keyboard checked-state changes', async () => {
    const user = userEvent.setup();
    render(<SwitchHarness />);

    const control = screen.getByRole('switch', {
      name: 'Email notifications',
    });
    expect(control).not.toBeChecked();

    await user.click(control);
    expect(control).toBeChecked();

    control.focus();
    await user.keyboard('[Space]');
    expect(control).not.toBeChecked();
  });

  it('does not change while disabled', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(
      <Switch
        aria-label="Locked preference"
        disabled
        onCheckedChange={onCheckedChange}
      />,
    );

    await user.click(screen.getByRole('switch', { name: 'Locked preference' }));
    expect(onCheckedChange).not.toHaveBeenCalled();
  });

  it('participates in native form submission', () => {
    render(
      <form aria-label="Preference form">
        <Switch
          aria-label="Enable reminders"
          defaultChecked
          name="reminders"
          value="enabled"
        />
      </form>,
    );

    const form = screen.getByRole<HTMLFormElement>('form', {
      name: 'Preference form',
    });
    expect(new FormData(form).get('reminders')).toBe('enabled');
  });
});
