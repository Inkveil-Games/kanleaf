import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Checkbox } from './Checkbox';

function CheckboxHarness() {
  const [checked, setChecked] = useState(false);
  return (
    <Checkbox
      aria-label="Select task"
      checked={checked}
      onCheckedChange={setChecked}
    />
  );
}

describe('Checkbox', () => {
  it('supports pointer and keyboard checked-state changes', async () => {
    const user = userEvent.setup();
    render(<CheckboxHarness />);

    const checkbox = screen.getByRole('checkbox', { name: 'Select task' });
    expect(checkbox).not.toBeChecked();

    await user.click(checkbox);
    expect(checkbox).toBeChecked();

    checkbox.focus();
    await user.keyboard('[Space]');
    expect(checkbox).not.toBeChecked();
  });

  it('does not change while disabled', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(
      <Checkbox
        aria-label="Locked selection"
        disabled
        onCheckedChange={onCheckedChange}
      />,
    );

    await user.click(
      screen.getByRole('checkbox', { name: 'Locked selection' }),
    );
    expect(onCheckedChange).not.toHaveBeenCalled();
  });

  it('participates in native form submission', () => {
    render(
      <form aria-label="Selection form">
        <Checkbox
          aria-label="Include archived"
          defaultChecked
          name="archived"
          value="yes"
        />
      </form>,
    );

    const form = screen.getByRole<HTMLFormElement>('form', {
      name: 'Selection form',
    });
    expect(new FormData(form).get('archived')).toBe('yes');
  });
});
