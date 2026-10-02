import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MarkdownSourceEditor } from './MarkdownSourceEditor';

vi.mock('@uiw/react-codemirror', () => ({
  default: (props: {
    value: string;
    onChange: (value: string) => void;
    editable?: boolean;
    className?: string;
    'aria-label'?: string;
  }) => (
    <textarea
      aria-label={props['aria-label']}
      className={props.className}
      value={props.value}
      readOnly={props.editable === false}
      onChange={(event) => props.onChange(event.currentTarget.value)}
    />
  ),
}));

describe('MarkdownSourceEditor', () => {
  it('edits raw Markdown without a second visual-preview mode', () => {
    const onChange = vi.fn();
    render(<MarkdownSourceEditor value="# Source" onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('Markdown source'), {
      target: { value: '# Updated source' },
    });
    expect(onChange).toHaveBeenCalledWith('# Updated source');
    expect(screen.getByLabelText('Markdown source')).toHaveClass(
      'markdown-source-editor',
    );
  });

  it('supports read-only source rendering', () => {
    render(
      <MarkdownSourceEditor
        value="Durable Markdown"
        onChange={vi.fn()}
        readOnly
      />,
    );
    expect(screen.getByLabelText('Markdown source')).toHaveAttribute(
      'readonly',
    );
  });
});
