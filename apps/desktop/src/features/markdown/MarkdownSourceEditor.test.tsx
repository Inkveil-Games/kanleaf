import { fireEvent, render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MarkdownSourceEditor } from './MarkdownSourceEditor';

const source = `# Live Preview

- [x] Durable source

| Layer | Store |
| --- | --- |
| Task | PostgreSQL |

\`\`\`rust
let faithful = true;
\`\`\`

<script>window.unsafeLivePreview = true</script>
`;

const themedSource = `# Calm source

> A **strong** [reference](https://kanleaf.example.com) with \`inline code\`.

\`\`\`typescript
const ready: boolean = true;
\`\`\`
`;

describe('MarkdownSourceEditor', () => {
  it('highlights Markdown and fenced code with the Kanleaf syntax theme', async () => {
    const { container } = render(
      <MarkdownSourceEditor value={themedSource} onChange={vi.fn()} />,
    );
    const highlightedText = (className: string) =>
      Array.from(container.querySelectorAll(className))
        .map((element) => element.textContent)
        .join('');

    expect(highlightedText('.cm-syntax-heading')).toContain('Calm source');
    expect(highlightedText('.cm-syntax-link')).toContain('reference');
    expect(highlightedText('.cm-syntax-strong')).toContain('strong');
    expect(highlightedText('.cm-syntax-code')).toContain('inline code');
    await waitFor(() =>
      expect(highlightedText('.cm-syntax-keyword')).toContain('const'),
    );
    expect(highlightedText('.cm-syntax-type')).toContain('boolean');
  });

  it('renders inactive blocks and reveals their exact source on pointer entry', async () => {
    const { container } = render(
      <MarkdownSourceEditor value={source} onChange={vi.fn()} livePreview />,
    );

    const table = await waitFor(() => {
      const rendered = container.querySelector('.cm-live-block-widget table');
      expect(rendered).toBeInTheDocument();
      return rendered!;
    });
    expect(
      container.querySelector('.cm-live-block-widget pre'),
    ).toHaveTextContent('let faithful = true;');
    expect(container.querySelector('script')).not.toBeInTheDocument();
    expect(container).not.toHaveTextContent('unsafeLivePreview');

    fireEvent.mouseDown(table);
    await waitFor(() =>
      expect(
        container.querySelector('.cm-live-block-widget table'),
      ).not.toBeInTheDocument(),
    );
    expect(container.querySelector('.cm-content')).toHaveTextContent(
      '| Layer | Store |',
    );
  });

  it('toggles task markers by editing the Markdown source', async () => {
    const onChange = vi.fn();
    const { container } = render(
      <MarkdownSourceEditor value={source} onChange={onChange} livePreview />,
    );

    const checkbox = await waitFor(() => {
      const rendered = container.querySelector<HTMLInputElement>(
        '.cm-live-task-marker',
      );
      expect(rendered).toBeInTheDocument();
      return rendered!;
    });
    fireEvent.click(checkbox);

    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        expect.stringContaining('- [ ] Durable source'),
        expect.anything(),
      ),
    );

    fireEvent.keyDown(container.querySelector('.cm-content')!, {
      key: 'z',
      ctrlKey: true,
    });
    await waitFor(() =>
      expect(onChange.mock.calls.at(-1)?.[0]).toContain('- [x] Durable source'),
    );
  });
});
