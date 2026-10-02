import { waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMermaidPreview, mountMermaidPreviews } from './mermaidPreview';

const layout = vi.hoisted(() => vi.fn());

// JSDOM cannot lay out SVG text. Keep the actual preview lifecycle and replace
// only Mermaid's browser layout engine with a deterministic rendered result.
vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: async (id: string, _source: string, container?: HTMLElement) => {
      layout(container);
      return {
        svg: `<svg id="${id}"><text>Rendered diagram</text></svg>`,
        diagramType: 'flowchart-v2',
      };
    },
  },
}));

afterEach(() => {
  document.body.replaceChildren();
  delete document.documentElement.dataset.theme;
  layout.mockReset();
});

function mount(block: HTMLElement, source = 'graph LR\nA --> B') {
  block.replaceChildren(createMermaidPreview(source));
  mountMermaidPreviews(block);
  return block.querySelector('kanleaf-mermaid-preview');
}

async function rendered(block: HTMLElement) {
  await waitFor(() =>
    expect(block.querySelector('kanleaf-mermaid-preview')).toHaveAttribute(
      'aria-busy',
      'false',
    ),
  );
  const svg = block.querySelector('svg');
  expect(svg).not.toBeNull();
  return svg;
}

function codeBlock() {
  const block = document.createElement('div');
  block.className = 'milkdown-code-block';
  document.body.append(block);
  return block;
}

describe('virtualized Mermaid previews', () => {
  it('retains the cache while Crepe mounts its empty preview panel', async () => {
    const block = codeBlock();
    mount(block);
    const svg = await rendered(block);
    block.classList.add('has-mermaid-preview');
    block.style.setProperty('--mermaid-block-height', '300px');
    const panel = document.createElement('div');
    panel.className = 'preview-panel';
    block.replaceChildren(panel);
    // Crepe mounts the panel before its watchEffect clones the preview HTML.
    mountMermaidPreviews(document.body);
    expect(block).toHaveClass('has-mermaid-preview');
    mount(block);
    expect(block.querySelector('svg')).toBe(svg);
  });

  it('releases the reserved height when changed to ordinary code', async () => {
    const block = codeBlock();
    mount(block);
    await rendered(block);
    block.classList.add('has-mermaid-preview');
    block.style.setProperty('--mermaid-block-height', '300px');
    const code = document.createElement('div');
    code.className = 'codemirror-host';
    block.replaceChildren(code);
    mountMermaidPreviews(document.body);
    expect(block).not.toHaveClass('has-mermaid-preview');
    expect(block.style.getPropertyValue('--mermaid-block-height')).toBe('');
  });

  it('measures inside an isolated connected container and removes it afterwards', async () => {
    const containers: HTMLElement[] = [];
    layout.mockImplementation((container: HTMLElement | undefined) => {
      expect(container).toBeInstanceOf(HTMLElement);
      expect(container).toHaveClass('markdown-diagram-measure');
      expect(container).toHaveAttribute('aria-hidden', 'true');
      expect(container?.isConnected).toBe(true);
      if (container) containers.push(container);
    });
    const block = codeBlock();
    mount(block);
    await rendered(block);
    expect(containers).toHaveLength(1);
    expect(containers[0]?.isConnected).toBe(false);
  });

  it('removes the measurement container after a render error', async () => {
    let container: HTMLElement | undefined;
    layout.mockImplementation((element: HTMLElement | undefined) => {
      container = element;
      throw new Error('Invalid diagram');
    });
    const block = codeBlock();
    mount(block);
    await waitFor(() =>
      expect(block.querySelector('kanleaf-mermaid-preview')).toHaveClass(
        'is-error',
      ),
    );
    expect(container).toBeInstanceOf(HTMLElement);
    expect(container?.isConnected).toBe(false);
  });

  it('restores the rendered diagram immediately after offscreen teardown', async () => {
    const block = codeBlock();
    mount(block);
    const svg = await rendered(block);
    block.replaceChildren();
    mount(block);
    expect(block.querySelector('svg')).toBe(svg);
    expect(block.querySelector('kanleaf-mermaid-preview')).toHaveAttribute(
      'aria-busy',
      'false',
    );
  });

  it('renders new source instead of restoring an obsolete diagram', async () => {
    const block = codeBlock();
    mount(block);
    const svg = await rendered(block);
    mount(block, 'graph LR\nC --> D');
    expect(await rendered(block)).not.toBe(svg);
    expect(block.querySelector('kanleaf-mermaid-preview')).toHaveAttribute(
      'data-source',
      'graph LR\nC --> D',
    );
  });

  it('refreshes the theme after an offscreen theme switch', async () => {
    const block = codeBlock();
    document.documentElement.dataset.theme = 'light';
    mount(block);
    const svg = await rendered(block);
    block.replaceChildren();
    document.documentElement.dataset.theme = 'dark';
    mount(block);
    expect(await rendered(block)).not.toBe(svg);
  });

  it('keeps separate diagram identities for equal source in different blocks', async () => {
    const first = codeBlock();
    const second = codeBlock();
    mount(first);
    mount(second);
    expect((await rendered(first))?.id).not.toBe((await rendered(second))?.id);
  });
});
