import { createContext } from 'react';

export interface OutlineHeading {
  /** Offset of the heading's first line in the Markdown source. */
  offset: number;
  depth: number;
  text: string;
}

export interface OutlineSnapshot {
  headings: OutlineHeading[];
  /** Source offset at the top of the open note's viewport. */
  activeOffset: number | null;
  /** Whether a note is open and publishing its headings. */
  attached: boolean;
}

const ATX_HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const SETEXT_UNDERLINE = /^ {0,3}(=+|-+)[ \t]*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** ATX and setext headings outside front matter and fenced code. */
export function markdownHeadings(markdown: string): OutlineHeading[] {
  const headings: OutlineHeading[] = [];
  const lines = markdown.split('\n');
  let offset = 0;
  let index = 0;
  let fence: string | null = null;
  let paragraph: { offset: number; text: string } | null = null;

  if (lines[0]?.trimEnd() === '---') {
    const close = lines.findIndex(
      (line, position) =>
        position > 0 && (line.trimEnd() === '---' || line.trimEnd() === '...'),
    );
    if (close > 0) {
      for (; index <= close; index += 1) offset += lines[index].length + 1;
    }
  }

  for (; index < lines.length; index += 1) {
    const line = lines[index].replace(/\r$/, '');
    const lineOffset = offset;
    offset += lines[index].length + 1;

    const fenceMatch = FENCE.exec(line);
    if (fence) {
      if (
        fenceMatch &&
        fenceMatch[1][0] === fence[0] &&
        fenceMatch[1].length >= fence.length &&
        line.trim() === fenceMatch[1]
      )
        fence = null;
      continue;
    }
    if (fenceMatch) {
      fence = fenceMatch[1];
      paragraph = null;
      continue;
    }

    const atx = ATX_HEADING.exec(line);
    if (atx) {
      const text = plainHeadingText(atx[2] ?? '');
      if (text)
        headings.push({ offset: lineOffset, depth: atx[1].length, text });
      paragraph = null;
      continue;
    }

    const setext = SETEXT_UNDERLINE.exec(line);
    if (setext && paragraph) {
      const text = plainHeadingText(paragraph.text);
      if (text)
        headings.push({
          offset: paragraph.offset,
          depth: setext[1][0] === '=' ? 1 : 2,
          text,
        });
      paragraph = null;
      continue;
    }

    const trimmed = line.trim();
    paragraph =
      trimmed &&
      !/^ {0,3}([>*+-]|\d+[.)])\s/.test(line) &&
      !line.startsWith('    ')
        ? (paragraph ?? { offset: lineOffset, text: trimmed })
        : null;
  }
  return headings;
}

function plainHeadingText(source: string) {
  return source
    .replace(
      /\[\[([^\]|#]*)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g,
      (_, target, alias) => (alias || target.split('/').pop() || '').trim(),
    )
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/(\*\*|__|~~|`|\*|_)/g, '')
    .replace(/\\([\\`*_{}[\]()#+\-.!])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface OutlineNode {
  heading: OutlineHeading;
  index: number;
  children: OutlineNode[];
}

/** Nests headings by depth, tolerating skipped levels such as h1 → h3. */
export function outlineTree(headings: OutlineHeading[]): OutlineNode[] {
  const roots: OutlineNode[] = [];
  const stack: OutlineNode[] = [];
  for (const [index, heading] of headings.entries()) {
    while (
      stack.length &&
      stack[stack.length - 1].heading.depth >= heading.depth
    )
      stack.pop();
    const node: OutlineNode = { heading, index, children: [] };
    (stack.at(-1)?.children ?? roots).push(node);
    stack.push(node);
  }
  return roots;
}

/** The heading the reader is in: the last one starting at or above the top. */
export function activeHeadingIndex(
  headings: OutlineHeading[],
  activeOffset: number | null,
) {
  if (activeOffset === null) return -1;
  let active = -1;
  for (const [index, heading] of headings.entries()) {
    if (heading.offset > activeOffset) break;
    active = index;
  }
  return active;
}

function sameHeadings(left: OutlineHeading[], right: OutlineHeading[]) {
  return (
    left.length === right.length &&
    left.every(
      (heading, index) =>
        heading.offset === right[index].offset &&
        heading.depth === right[index].depth &&
        heading.text === right[index].text,
    )
  );
}

/**
 * Bridges the open note's editor and the Library sidebar outline, which live in
 * separate panes. The editor publishes headings and how to reveal them; the
 * sidebar reads them and asks to reveal one.
 */
export class DocumentOutlineStore {
  private snapshot: OutlineSnapshot = {
    headings: [],
    activeOffset: null,
    attached: false,
  };
  private revealHeading: ((heading: OutlineHeading) => void) | null = null;
  private readonly listeners = new Set<() => void>();

  getSnapshot = () => this.snapshot;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  publish(
    headings: OutlineHeading[],
    reveal: (heading: OutlineHeading) => void,
  ) {
    this.revealHeading = reveal;
    if (
      this.snapshot.attached &&
      sameHeadings(this.snapshot.headings, headings)
    )
      return;
    this.update({ ...this.snapshot, headings, attached: true });
  }

  setActive(activeOffset: number | null) {
    if (this.snapshot.activeOffset === activeOffset) return;
    this.update({ ...this.snapshot, activeOffset });
  }

  clear() {
    this.revealHeading = null;
    if (!this.snapshot.attached) return;
    this.update({ headings: [], activeOffset: null, attached: false });
  }

  reveal(heading: OutlineHeading) {
    this.revealHeading?.(heading);
  }

  private update(snapshot: OutlineSnapshot) {
    this.snapshot = snapshot;
    this.listeners.forEach((listener) => listener());
  }
}

export const DocumentOutlineContext =
  createContext<DocumentOutlineStore | null>(null);
