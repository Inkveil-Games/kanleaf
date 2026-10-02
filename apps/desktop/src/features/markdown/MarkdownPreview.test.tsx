import { render, screen, waitFor } from '@testing-library/react';
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
  it('renders math and smart punctuation without changing code or link destinations', () => {
    const { container } = render(
      <MarkdownPreview
        content={
          '"Hello" -- isn\'t ...\n\n$x^2$\n\n$$\nx^2 + y^2\n$$\n\n`"code" --`\n\n["link"](https://example.com/a--b)'
        }
      />,
    );
    expect(container).toHaveTextContent('“Hello” – isn’t …');
    expect(container.querySelectorAll('.katex')).toHaveLength(2);
    expect(container.querySelector('code')).toHaveTextContent('"code" --');
    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      'https://example.com/a--b',
    );
  });
  it('renders GFM content while discarding raw HTML', () => {
    const { container } = render(
      <MarkdownPreview
        content={`# Release notes

- [x] Keep Markdown source
- [ ] Ship preview

| Area | State |
| --- | --- |
| Vault | Ready |

\`\`\`ts
const ready = true;
\`\`\`

<script>alert('unsafe')</script>`}
      />,
    );

    expect(
      screen.getByRole('heading', { name: 'Release notes' }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('checkbox')[0]).toBeChecked();
    expect(screen.getByRole('table')).toHaveTextContent('VaultReady');
    expect(screen.getByRole('table')).toHaveClass('ui-native-scrollbar');
    expect(container.querySelector('pre')).toHaveClass('ui-native-scrollbar');
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

  it('resolves portable Kanleaf asset references in Reading mode', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(new Blob(['image']), { status: 200 }));
    const createObjectUrl = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:kanleaf-image');

    render(
      <MarkdownPreview
        content="![Architecture](kanleaf-asset://images/550e8400-e29b-41d4-a716-446655440000.png)"
        assetContext={{
          serverUrl: 'http://127.0.0.1:3000',
          token: 'token',
          workspaceId: 'workspace-id',
          target: { kind: 'task', id: 'task-id' },
        }}
      />,
    );

    await waitFor(() =>
      expect(screen.getByRole('img', { name: 'Architecture' })).toHaveAttribute(
        'src',
        'blob:kanleaf-image',
      ),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/assets/images/550e8400-e29b-41d4-a716'),
      expect.objectContaining({
        headers: { authorization: 'Bearer token' },
      }),
    );
    expect(createObjectUrl).toHaveBeenCalledOnce();
  });
});
