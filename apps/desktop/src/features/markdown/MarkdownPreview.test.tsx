import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { MarkdownPreview } from './MarkdownPreview';

function EditablePreview({ initialContent }: { initialContent: string }) {
  const [content, setContent] = useState(initialContent);
  return (
    <>
      <MarkdownPreview content={content} onTaskToggle={setContent} />
      <output aria-label="Markdown source">{content}</output>
    </>
  );
}

describe('MarkdownPreview', () => {
  it('renders GFM content while discarding raw HTML', () => {
    const { container } = render(
      <MarkdownPreview
        content={`# Release notes

- [x] Keep Markdown source
- [ ] Ship preview

| Area | State |
| --- | --- |
| Vault | Ready |

<script>alert('unsafe')</script>`}
      />,
    );

    expect(
      screen.getByRole('heading', { name: 'Release notes' }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('checkbox')[0]).toBeChecked();
    expect(screen.getByRole('table')).toHaveTextContent('VaultReady');
    expect(container.querySelector('script')).not.toBeInTheDocument();
    expect(container).not.toHaveTextContent('unsafe');
  });

  it('renders checked and unchecked tasks from the Markdown source', () => {
    render(<MarkdownPreview content={'- [ ] Open\n- [X] Complete'} />);

    const [open, complete] = screen.getAllByRole('checkbox');
    expect(open).not.toBeChecked();
    expect(complete).toBeChecked();
    expect(open).toBeDisabled();
    expect(complete).toBeDisabled();
  });

  it('toggles only the source marker for duplicate task labels', async () => {
    const user = userEvent.setup();
    render(
      <EditablePreview
        initialContent={'Before\n\n- [ ] Fix bug\n- [ ] Fix bug\n\nAfter'}
      />,
    );

    await user.click(screen.getAllByRole('checkbox')[1]!);

    expect(screen.getByLabelText('Markdown source')).toHaveTextContent(
      'Before - [ ] Fix bug - [x] Fix bug After',
    );
    expect(screen.getAllByRole('checkbox')[0]).not.toBeChecked();
    expect(screen.getAllByRole('checkbox')[1]).toBeChecked();
  });

  it('patches the exact nested task without reformatting surrounding source', async () => {
    const user = userEvent.setup();
    const source =
      '- [ ] Parent\n  *   [ ] Child A\n  *   [x] Child B\n\nParagraph  with  spacing.';
    render(<EditablePreview initialContent={source} />);

    await user.click(screen.getAllByRole('checkbox')[1]!);

    expect(screen.getByLabelText('Markdown source')).toHaveTextContent(
      '- [ ] Parent * [x] Child A * [x] Child B Paragraph with spacing.',
    );
    expect(screen.getByLabelText('Markdown source').textContent).toBe(
      '- [ ] Parent\n  *   [x] Child A\n  *   [x] Child B\n\nParagraph  with  spacing.',
    );
  });

  it('enables a task checkbox rendered inside a loose list paragraph', async () => {
    const user = userEvent.setup();
    const source =
      '- [ ] Loose task\n\n  Extra detail.\n\n- [x] Second loose task';
    render(<EditablePreview initialContent={source} />);
    const [first, second] = screen.getAllByRole('checkbox');

    expect(first).not.toBeDisabled();
    expect(second).not.toBeDisabled();
    await user.click(first!);

    expect(screen.getByLabelText('Markdown source').textContent).toBe(
      '- [x] Loose task\n\n  Extra detail.\n\n- [x] Second loose task',
    );
  });

  it('retains focus and toggles an editable task repeatedly with Space', async () => {
    const user = userEvent.setup();
    render(<EditablePreview initialContent="1. [x] Keyboard task" />);
    const checkbox = screen.getByRole('checkbox');

    checkbox.focus();
    await user.keyboard(' ');

    expect(screen.getByLabelText('Markdown source').textContent).toBe(
      '1. [ ] Keyboard task',
    );
    const updatedCheckbox = screen.getByRole('checkbox');
    expect(updatedCheckbox).not.toBeChecked();
    expect(document.activeElement).toBe(updatedCheckbox);

    await user.keyboard(' ');

    expect(screen.getByLabelText('Markdown source').textContent).toBe(
      '1. [x] Keyboard task',
    );
    expect(screen.getByRole('checkbox')).toBeChecked();
    expect(document.activeElement).toBe(screen.getByRole('checkbox'));
  });

  it('leaves ordinary Reading content non-editable', () => {
    const onTaskToggle = vi.fn();
    const { container } = render(
      <MarkdownPreview
        content={'A regular paragraph.\n\n- [ ] Allowed control'}
        onTaskToggle={onTaskToggle}
      />,
    );

    expect(container.querySelector('.markdown-preview')).not.toHaveAttribute(
      'contenteditable',
    );
    expect(screen.getByText('A regular paragraph.')).not.toHaveAttribute(
      'contenteditable',
    );
    expect(screen.getByRole('checkbox')).not.toBeDisabled();
  });
});
