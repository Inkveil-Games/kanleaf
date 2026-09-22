import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { propertyIcon } from './propertyIcons';
import { SelectValueEditor, type SelectValueDraft } from './SelectValueEditor';

const todo: SelectValueDraft = {
  key: 'todo',
  id: 'todo',
  name: 'Todo',
  icon: 'circle',
  color: '#64748B',
  description: 'Ready to start',
  locked: true,
};

describe('SelectValueEditor', () => {
  it('locks system identity while keeping description, order, and default editable', () => {
    render(
      <SelectValueEditor
        disabled={false}
        values={[todo]}
        defaultValueId="todo"
        showDefault
        onChange={vi.fn()}
        onDefaultChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Reorder Todo' })).toBeEnabled();
    expect(
      screen.getByRole('button', { name: 'Change icon for Todo' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Change color for Todo' }),
    ).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Value name' })).toBeDisabled();
    expect(
      screen.getByRole('textbox', { name: 'Value description' }),
    ).toBeEnabled();
    expect(
      screen.getByRole('radio', { name: 'Use Todo as default' }),
    ).toBeChecked();
  });

  it('omits defaults for multi-select and creates an icon-free value', () => {
    const onChange = vi.fn();
    render(
      <SelectValueEditor
        disabled={false}
        values={[]}
        showDefault={false}
        onChange={onChange}
      />,
    );

    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add value' }));
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({
        name: '',
        icon: null,
        color: '#64748B',
        description: '',
      }),
    ]);
  });

  it('uses distinct empty and unknown fallbacks whose strokes inherit color', () => {
    const empty = createElement(propertyIcon(null), {
      className: 'empty-test',
    });
    const unknown = createElement(propertyIcon('legacy-unknown'), {
      className: 'unknown-test',
    });
    const { container } = render(
      <>
        {empty}
        {unknown}
      </>,
    );

    const emptyGlyph = container.querySelector('.empty-test');
    const unknownGlyph = container.querySelector('.unknown-test');
    if (!emptyGlyph || !unknownGlyph) throw new Error('Expected icon glyphs');
    expect(emptyGlyph.className).not.toBe(unknownGlyph.className);
    expect(emptyGlyph).toHaveAttribute('stroke', 'currentColor');
    expect(unknownGlyph).toHaveAttribute('stroke', 'currentColor');
    expect(container.querySelectorAll('svg')).toHaveLength(2);
  });
});
