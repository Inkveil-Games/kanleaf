import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ColorSwatchPicker } from './ColorSwatchPicker';

describe('ColorSwatchPicker', () => {
  it('selects a palette color and restores focus', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ColorSwatchPicker
        ariaLabel="Change color for Documentation"
        value="#64748B"
        onChange={onChange}
      />,
    );

    const trigger = screen.getByRole('button', {
      name: 'Change color for Documentation',
    });
    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: 'Blue 500' }));

    expect(onChange).toHaveBeenCalledWith('#3B82F6');
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('normalizes a valid custom hex value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ColorSwatchPicker
        ariaLabel="Change label color"
        value="#64748B"
        onChange={onChange}
      />,
    );

    await user.click(
      screen.getByRole('button', { name: 'Change label color' }),
    );
    const input = screen.getByRole('textbox', { name: 'Custom color' });
    await user.clear(input);
    await user.type(input, '#aabbcc');
    await user.click(screen.getByRole('button', { name: 'Use custom color' }));

    expect(onChange).toHaveBeenCalledWith('#AABBCC');
  });

  it('closes on Escape and respects the disabled state', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <ColorSwatchPicker
        ariaLabel="Change color"
        value="#64748B"
        onChange={vi.fn()}
      />,
    );
    const trigger = screen.getByRole('button', { name: 'Change color' });
    await user.click(trigger);
    expect(screen.getByText('Color')).toBeVisible();
    await user.keyboard('[Escape]');
    await waitFor(() =>
      expect(screen.queryByText('Color')).not.toBeInTheDocument(),
    );

    rerender(
      <ColorSwatchPicker
        ariaLabel="Change color"
        value="#64748B"
        onChange={vi.fn()}
        disabled
      />,
    );
    expect(trigger).toBeDisabled();
  });
});
