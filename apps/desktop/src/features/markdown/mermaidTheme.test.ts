import { describe, expect, it } from 'vitest';
import { adaptMermaidDefaultPaints } from './mermaidTheme';

function preview(svg: string) {
  const root = document.createElement('div');
  root.innerHTML = svg;
  root.style.setProperty('--color-text', '#eef0ea');
  root.style.setProperty('--color-text-muted', '#a5aaa1');
  root.style.setProperty('--color-diagram-series-1', '#9fbea8');
  root.style.setProperty('--color-diagram-series-2', '#9fb9cd');
  return root;
}

describe('Mermaid renderer default paints', () => {
  it('makes C4 default relationships readable without overwriting authored colors or node fills', () => {
    const root = preview(
      '<svg><text fill="#444444">Uses</text><line stroke="#444444"/><text fill="#dd8855">Authored</text><rect fill="#444444"/></svg>',
    );
    adaptMermaidDefaultPaints(root, 'c4', getComputedStyle(root));
    expect(root.querySelector('text')?.getAttribute('fill')).toBe('#eef0ea');
    expect(root.querySelector('line')?.getAttribute('stroke')).toBe('#a5aaa1');
    expect(root.querySelectorAll('text')[1].getAttribute('fill')).toBe(
      '#dd8855',
    );
    expect(root.querySelector('rect')?.getAttribute('fill')).toBe('#444444');
  });

  it('keeps Sankey node and gradient colors consistent while leaving explicit custom colors intact', () => {
    const root = preview(
      '<svg><g class="nodes"><rect fill="#4e79a7"/><rect fill="#f28e2c"/><rect fill="#dd8855"/></g><linearGradient><stop stop-color="#4e79a7"/><stop stop-color="#f28e2c"/></linearGradient></svg>',
    );
    adaptMermaidDefaultPaints(root, 'sankey', getComputedStyle(root));
    expect(
      [...root.querySelectorAll('rect')].map((node) =>
        node.getAttribute('fill'),
      ),
    ).toEqual(['#9fbea8', '#9fb9cd', '#dd8855']);
    expect(
      [...root.querySelectorAll('stop')].map((node) =>
        node.getAttribute('stop-color'),
      ),
    ).toEqual(['#9fbea8', '#9fb9cd']);
  });

  it('does not reinterpret the same colors in unrelated diagram types', () => {
    const root = preview(
      '<svg><text fill="#444444">Label</text><rect fill="#4e79a7"/></svg>',
    );
    const original = root.innerHTML;
    adaptMermaidDefaultPaints(root, 'flowchart-v2', getComputedStyle(root));
    expect(root.innerHTML).toBe(original);
  });

  it('makes Wardley anchors and stage dividers readable without recoloring authored labels', () => {
    const root = preview(
      '<svg><g class="wardley-stages"><line stroke="#000"/></g><text class="wardley-node-label" fill="#000">Author</text><text fill="#dd8855">Custom</text></svg>',
    );
    adaptMermaidDefaultPaints(root, 'wardley', getComputedStyle(root));
    expect(root.querySelector('text')?.getAttribute('fill')).toBe('#eef0ea');
    expect(root.querySelector('line')?.getAttribute('stroke')).toBe('#a5aaa1');
    expect(root.querySelectorAll('text')[1].getAttribute('fill')).toBe(
      '#dd8855',
    );
  });
});
