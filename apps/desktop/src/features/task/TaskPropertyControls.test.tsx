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

  it('keeps its accessible label when using a separate empty prompt', () => {
    const { rerender } = render(
      <TaskDateControl
        label="From"
        emptyLabel="Any date"
        value={null}
        disabled={false}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('From')).toHaveValue('');
    expect(screen.getByText('Any date')).toBeInTheDocument();

    rerender(
      <TaskDateControl
        label="From"
        emptyLabel="Any date"
        value="2026-10-03"
        disabled={false}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('From')).toHaveValue('2026-10-03');
    expect(screen.getByText('2026-10-03')).toBeInTheDocument();
    expect(screen.queryByText('Any date')).not.toBeInTheDocument();
  });
});
