import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MermaidDiagram } from './MermaidDiagram';

describe('Mermaid previews', () => {
  it('reports an oversized diagram without modifying its source', async () => {
    const source = 'a'.repeat(50_001);
    const { container } = render(<MermaidDiagram source={source} />);
    expect(
      screen.getByRole('img', { name: 'Mermaid diagram' }),
    ).toHaveAttribute('aria-busy', 'true');
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Diagram could not be rendered',
    );
    expect(container.querySelector('kanleaf-mermaid-preview')).toHaveAttribute(
      'data-source',
      source,
    );
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'false');
  });

  it('cancels a detached preview and uses the newly selected source', async () => {
    const { container, rerender } = render(
      <MermaidDiagram source={'a'.repeat(50_001)} />,
    );
    const old = container.querySelector('kanleaf-mermaid-preview');
    rerender(<MermaidDiagram source={'b'.repeat(50_001)} />);
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'false'),
    );
    expect(old?.isConnected).toBe(false);
    expect(old?.textContent).toBe('Rendering diagram…');
    expect(
      container.querySelector<HTMLElement>('kanleaf-mermaid-preview')?.dataset
        .source,
    ).toBe('b'.repeat(50_001));
  });
});
