import { adaptMermaidDefaultPaints, mermaidTheme } from './mermaidTheme';

let sequence = 0;
// Mermaid configuration is global: serialize configuration + rendering so
// concurrent diagrams cannot render with another document's theme.
let renderQueue: Promise<unknown> = Promise.resolve();
// Crepe retains the node-view root but tears down its children offscreen.
// Reuse one rendered result per live block; nothing survives editor disposal.
const blockPreviews = new WeakMap<HTMLElement, MermaidPreviewElement>();

class MermaidPreviewElement extends HTMLElement {
  private revision = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private observer: MutationObserver | undefined;
  private sizeObserver: ResizeObserver | undefined;
  private renderedDark: boolean | undefined;
  private media = window.matchMedia('(prefers-color-scheme: dark)');
  private themeChanged = () => this.schedule();

  connectedCallback() {
    this.className = 'markdown-diagram ui-native-scrollbar';
    this.setAttribute('role', 'img');
    this.setAttribute('aria-label', 'Mermaid diagram');
    this.observer = new MutationObserver(this.themeChanged);
    this.observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    this.media.addEventListener('change', this.themeChanged);
    const block = this.closest<HTMLElement>('.milkdown-code-block');
    if (block) {
      this.sizeObserver = new ResizeObserver(([entry]) => {
        if (!entry || this.getAttribute('aria-busy') !== 'false') return;
        const height =
          entry.borderBoxSize[0]?.blockSize ??
          block.getBoundingClientRect().height;
        if (!height) return;
        block.style.setProperty('--mermaid-block-height', `${height}px`);
        block.classList.add('has-mermaid-preview');
      });
      this.sizeObserver.observe(block, { box: 'border-box' });
    }
    this.schedule();
  }

  disconnectedCallback() {
    this.revision++;
    clearTimeout(this.timer);
    this.observer?.disconnect();
    this.sizeObserver?.disconnect();
    this.media.removeEventListener('change', this.themeChanged);
  }

  private schedule() {
    const revision = ++this.revision;
    clearTimeout(this.timer);
    const dark =
      document.documentElement.dataset.theme === 'dark' ||
      (document.documentElement.dataset.theme !== 'light' &&
        this.media.matches);
    if (this.renderedDark === dark) {
      this.setAttribute('aria-busy', 'false');
      return;
    }
    this.setAttribute('aria-busy', 'true');
    if (!this.firstChild) this.textContent = 'Rendering diagram…';
    this.timer = setTimeout(() => {
      renderQueue = renderQueue
        .catch(() => undefined)
        .then(async () => {
          if (!this.isConnected || revision !== this.revision) return;
          const source = this.dataset.source ?? '';
          let measurement: HTMLDivElement | undefined;
          try {
            if (source.length > 50_000)
              throw new Error('Diagram is too large.');
            const { default: mermaid } = await import('mermaid');
            if (!this.isConnected || revision !== this.revision) return;
            const style = getComputedStyle(this);
            mermaid.initialize({
              ...mermaidTheme(style, dark),
              startOnLoad: false,
              securityLevel: 'strict',
              suppressErrorRendering: true,
              maxTextSize: 50_000,
              theme: 'base',
              secure: [
                'securityLevel',
                'startOnLoad',
                'maxTextSize',
                'maxEdges',
                'suppressErrorRendering',
                'theme',
                'themeVariables',
                'themeCSS',
              ],
            });
            // Mermaid needs connected SVGs for text measurement. Its default
            // body container changes page overflow while async layout runs.
            measurement = document.createElement('div');
            measurement.className = 'markdown-diagram-measure';
            measurement.setAttribute('aria-hidden', 'true');
            document.body.append(measurement);
            const { svg, diagramType } = await mermaid.render(
              `kanleaf-diagram-${++sequence}`,
              source,
              measurement,
            );
            if (!this.isConnected || revision !== this.revision) return;
            // Only Mermaid's strict, sanitized output enters this boundary.
            this.innerHTML = svg;
            this.dataset.diagramType = diagramType;
            adaptMermaidDefaultPaints(this, diagramType, style);
            this.setAttribute('role', 'img');
            this.classList.remove('is-error');
            this.renderedDark = dark;
          } catch {
            if (!this.isConnected || revision !== this.revision) return;
            this.renderedDark = undefined;
            this.textContent =
              'Diagram could not be rendered. Edit the Mermaid code to fix its syntax.';
            this.setAttribute('role', 'status');
            this.classList.add('is-error');
          } finally {
            measurement?.remove();
            if (revision === this.revision)
              this.setAttribute('aria-busy', 'false');
          }
        });
    }, 180);
  }
}

if (!customElements.get('kanleaf-mermaid-preview')) {
  customElements.define('kanleaf-mermaid-preview', MermaidPreviewElement);
}

export function createMermaidPreview(source: string) {
  // Crepe sanitizes and clones preview HTML. Mount the renderer after that
  // sanitation boundary using an inert standard-element placeholder.
  const host = document.createElement('div');
  host.className = 'markdown-diagram-host';
  // Data attributes are removed by Crepe's preview sanitizer. Text survives
  // that clone boundary without interpreting source as HTML.
  host.textContent = source;
  return host;
}

export function mountMermaidPreviews(root: HTMLElement) {
  root
    .querySelectorAll<HTMLElement>('.markdown-diagram-host')
    .forEach((host) => {
      if (host.querySelector('kanleaf-mermaid-preview')) return;
      const source = host.textContent ?? '';
      const block = host.closest<HTMLElement>('.milkdown-code-block');
      const cached = block ? blockPreviews.get(block) : undefined;
      const preview =
        cached?.dataset.source === source
          ? cached
          : (document.createElement(
              'kanleaf-mermaid-preview',
            ) as MermaidPreviewElement);
      preview.dataset.source = source;
      if (block) blockPreviews.set(block, preview);
      host.replaceChildren(preview);
    });
  root
    .querySelectorAll<HTMLElement>('.milkdown-code-block.has-mermaid-preview')
    .forEach((block) => {
      const placeholder = block.querySelector(
        '.milkdown-code-block-placeholder code',
      );
      const cached = blockPreviews.get(block);
      if (
        placeholder
          ? cached?.dataset.source !== placeholder.textContent
          : // Vue mounts the preview panel before cloning our host into it.
            // That intermediate state is not a change to ordinary fenced code.
            !block.querySelector('.preview-panel, .markdown-diagram-host')
      ) {
        blockPreviews.delete(block);
        block.classList.remove('has-mermaid-preview');
        block.style.removeProperty('--mermaid-block-height');
      }
    });
}
