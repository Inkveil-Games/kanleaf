import { createRef, useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SearchField } from './SearchField';

describe('SearchField', () => {
  it.each([{ isComposing: true }, { keyCode: 229 }])(
    'leaves IME keys to the input and suppresses shortcuts for %j',
    (composition) => {
      const onValueChange = vi.fn();
      const onKeyDown = vi.fn();
      const parentKeyDown = vi.fn();
      render(
        <div onKeyDown={parentKeyDown}>
          <SearchField
            aria-label="Search"
            value="漢"
            onValueChange={onValueChange}
            onKeyDown={onKeyDown}
          />
        </div>,
      );
      const input = screen.getByRole('searchbox');
      for (const key of ['Escape', 'Enter', 'ArrowDown']) {
        expect(fireEvent.keyDown(input, { key, ...composition })).toBe(true);
      }
      expect(input).toHaveValue('漢');
      expect(onValueChange).not.toHaveBeenCalled();
      expect(onKeyDown).not.toHaveBeenCalled();
      expect(parentKeyDown).not.toHaveBeenCalled();
    },
  );

  it('tracks composition until it ends and preserves consumer composition events', () => {
    const onValueChange = vi.fn();
    const onKeyDown = vi.fn();
    const parentKeyDown = vi.fn();
    const onCompositionStart = vi.fn();
    const onCompositionEnd = vi.fn();
    render(
      <div onKeyDown={parentKeyDown}>
        <SearchField
          aria-label="Search"
          value="漢"
          onValueChange={onValueChange}
          onKeyDown={onKeyDown}
          onCompositionStart={onCompositionStart}
          onCompositionEnd={onCompositionEnd}
        />
      </div>,
    );
    const input = screen.getByRole('searchbox');
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(onValueChange).not.toHaveBeenCalled();
    expect(onKeyDown).not.toHaveBeenCalled();
    expect(parentKeyDown).not.toHaveBeenCalled();
    expect(onCompositionStart).toHaveBeenCalledOnce();
    fireEvent.compositionEnd(input);
    expect(onCompositionEnd).toHaveBeenCalledOnce();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onValueChange).toHaveBeenCalledExactlyOnceWith('');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(onKeyDown).toHaveBeenCalledOnce();
    expect(parentKeyDown).toHaveBeenCalledOnce();
  });

  it('resets composition tracking when focus leaves the input', () => {
    const onValueChange = vi.fn();
    const onBlur = vi.fn();
    render(
      <SearchField
        aria-label="Search"
        value="漢"
        onValueChange={onValueChange}
        onBlur={onBlur}
      />,
    );
    const input = screen.getByRole('searchbox');
    fireEvent.compositionStart(input);
    fireEvent.blur(input);
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onBlur).toHaveBeenCalledOnce();
    expect(onValueChange).toHaveBeenCalledExactlyOnceWith('');
  });

  it('forwards its input ref and native props and restores focus when cleared', async () => {
    const user = userEvent.setup();
    const ref = createRef<HTMLInputElement>();
    function Example() {
      const [value, setValue] = useState('Task');
      return (
        <SearchField
          ref={ref}
          aria-label="Search Tasks"
          name="query"
          placeholder="Search"
          value={value}
          onValueChange={setValue}
        />
      );
    }
    render(<Example />);
    const input = screen.getByRole('searchbox', { name: 'Search Tasks' });
    expect(ref.current).toBe(input);
    expect(input).toHaveAttribute('name', 'query');
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(input).toHaveValue('');
    expect(input).toHaveFocus();
    expect(
      screen.queryByRole('button', { name: 'Clear search' }),
    ).not.toBeInTheDocument();
    await user.type(input, 'New');
    expect(input).toHaveValue('New');
  });

  it('consumes Escape only when it clears an editable value', () => {
    const parentKeyDown = vi.fn();
    const inputKeyDown = vi.fn();
    function Example() {
      const [value, setValue] = useState('Task');
      return (
        <div onKeyDown={parentKeyDown}>
          <SearchField
            aria-label="Search Tasks"
            value={value}
            onValueChange={setValue}
            onKeyDown={inputKeyDown}
          />
        </div>
      );
    }
    render(<Example />);
    const input = screen.getByRole('searchbox');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input).toHaveValue('');
    expect(parentKeyDown).not.toHaveBeenCalled();
    expect(inputKeyDown).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(parentKeyDown).toHaveBeenCalledOnce();
    expect(inputKeyDown).toHaveBeenCalledOnce();
  });

  it('does not offer clearing for read-only and disabled fields', () => {
    const onValueChange = vi.fn();
    const { rerender } = render(
      <SearchField
        aria-label="Search"
        value="Task"
        onValueChange={onValueChange}
        readOnly
      />,
    );
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' });
    expect(onValueChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    rerender(
      <SearchField
        aria-label="Search"
        value="Task"
        onValueChange={onValueChange}
        disabled
      />,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
