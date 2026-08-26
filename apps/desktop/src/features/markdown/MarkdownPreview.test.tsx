import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MarkdownPreview } from './MarkdownPreview';

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
});
