import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TaskDateControl } from './TaskPropertyControls';

const originalShowPicker = Object.getOwnPropertyDescriptor(
  HTMLInputElement.prototype,
  'showPicker',
);

describe('TaskDateControl', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    if (originalShowPicker) {
      Object.defineProperty(
        HTMLInputElement.prototype,
        'showPicker',
        originalShowPicker,
      );
    } else {
      Reflect.deleteProperty(HTMLInputElement.prototype, 'showPicker');
    }
  });

  it('opens the native calendar from the whole date control', async () => {
    const showPicker = vi.fn();
    Object.defineProperty(HTMLInputElement.prototype, 'showPicker', {
      configurable: true,
      value: showPicker,
    });
    const user = userEvent.setup();

    render(
      <TaskDateControl
        label="Start date"
        value={null}
        disabled={false}
        onChange={vi.fn()}
      />,
    );

    await user.click(screen.getByLabelText('Start date'));

    expect(showPicker).toHaveBeenCalledOnce();
  });
});
