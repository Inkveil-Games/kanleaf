interface MdastNode {
  type: string;
  value?: string;
  children?: MdastNode[];
}

interface Text extends MdastNode {
  type: 'text';
  value: string;
}

// Links are stored Obsidian-style by vault path (`[[grep_sed_awk]]`,
// `[[tasks/42]]`), so a vault opened in Obsidian keeps working, while Kanleaf
// shows the live title. Titles never enter the file, so renames do not break
// links: storage names are fixed when a page or Task is created.
export const INTERNAL_LINK_PATTERN =
  /\[\[([^[\]\n|#]+)(?:#([^[\]\n|]*))?(?:\|([^[\]\n]*))?\]\]/g;

export interface InternalLinkEntry {
  kind: 'page' | 'task';
  id: string;
  title: string;
  /** Vault path without the `.md` extension, e.g. `library/a/b` or `tasks/42`. */
  path: string;
  /** What the picker shows beside the title (`#42`, the parent folder). */
  hint: string;
  projectId: string | null;
}

export interface InternalLinkParts {
  target: string;
  heading: string | null;
  alias: string | null;
}

export interface InternalLinkIndex {
  entries: InternalLinkEntry[];
  resolve: (target: string) => InternalLinkEntry | null;
  linkTarget: (entry: InternalLinkEntry) => string;
}

export function parseInternalLink(raw: string): InternalLinkParts | null {
  INTERNAL_LINK_PATTERN.lastIndex = 0;
  const match = INTERNAL_LINK_PATTERN.exec(raw);
  if (!match || match.index !== 0 || match[0].length !== raw.length) {
    return null;
  }
  return {
    target: match[1]?.trim() ?? '',
    heading: match[2]?.trim() || null,
    alias: match[3]?.trim() || null,
  };
}

export function formatInternalLink({
  target,
  heading,
  alias,
}: InternalLinkParts) {
  return `[[${target}${heading ? `#${heading}` : ''}${alias ? `|${alias}` : ''}]]`;
}

export function createInternalLinkIndex(
  entries: InternalLinkEntry[],
): InternalLinkIndex {
  const byPath = new Map<string, InternalLinkEntry>();
  const bySuffix = new Map<string, InternalLinkEntry[]>();
  for (const entry of entries) {
    const path = normalizeTarget(entry.path);
    byPath.set(path, entry);
    const segments = path.split('/');
    for (let start = 0; start < segments.length; start += 1) {
      const suffix = segments.slice(start).join('/');
      bySuffix.set(suffix, [...(bySuffix.get(suffix) ?? []), entry]);
    }
  }

  return {
    entries,
    resolve(target) {
      const normalized = normalizeTarget(target);
      return byPath.get(normalized) ?? bySuffix.get(normalized)?.[0] ?? null;
    },
    // The shortest path suffix that names exactly one file, as Obsidian does.
    linkTarget(entry) {
      const segments = normalizeTarget(entry.path).split('/');
      for (let start = segments.length - 1; start >= 0; start -= 1) {
        const suffix = segments.slice(start).join('/');
        if (bySuffix.get(suffix)?.length === 1) return suffix;
      }
      return segments.join('/');
    },
  };
}

export function searchInternalLinks(
  index: InternalLinkIndex,
  query: string,
  limit = 8,
): InternalLinkEntry[] {
  const needle = fold(query.trim());
  if (!needle) return index.entries.slice(0, limit);
  const scored: { entry: InternalLinkEntry; score: number }[] = [];
  for (const entry of index.entries) {
    const title = fold(entry.title);
    const path = fold(entry.path);
    const hint = fold(entry.hint);
    let score = -1;
    if (title.startsWith(needle)) score = 0;
    else if (title.includes(needle)) score = 1;
    else if (hint.includes(needle) || path.includes(needle)) score = 2;
    if (score >= 0) scored.push({ entry, score });
  }
  return scored
    .sort(
      (left, right) =>
        left.score - right.score ||
        left.entry.title.localeCompare(right.entry.title),
    )
    .slice(0, limit)
    .map(({ entry }) => entry);
}

export function internalLinkLabel(
  parts: InternalLinkParts,
  entry: InternalLinkEntry | null,
) {
  if (parts.alias) return parts.alias;
  const base = entry
    ? entry.kind === 'task'
      ? `${entry.hint} ${entry.title}`
      : entry.title
    : parts.target;
  return parts.heading ? `${base} › ${parts.heading}` : base;
}

/**
 * Turns `[[…]]` inside text nodes into `internalLink` mdast nodes. Code, inline
 * code and existing links are left alone because they are not text nodes.
 */
export function remarkInternalLinks() {
  return (tree: MdastNode) => {
    replaceInternalLinks(tree);
  };
}

function replaceInternalLinks(node: MdastNode) {
  if (!node.children || node.type === 'link' || node.type === 'linkReference') {
    return;
  }
  node.children = node.children.flatMap((child): MdastNode[] => {
    if (child.type === 'text' && child.value?.includes('[[')) {
      return splitInternalLinks(child.value);
    }
    replaceInternalLinks(child);
    return [child];
  });
}

export interface InternalLinkNode {
  type: 'internalLink';
  value: string;
  data: {
    hName: 'a';
    hProperties: Record<string, string>;
    hChildren: { type: 'text'; value: string }[];
  };
}

function splitInternalLinks(value: string): (Text | InternalLinkNode)[] {
  const parts: (Text | InternalLinkNode)[] = [];
  let cursor = 0;
  INTERNAL_LINK_PATTERN.lastIndex = 0;
  for (const match of value.matchAll(INTERNAL_LINK_PATTERN)) {
    if (match.index > cursor) {
      parts.push({ type: 'text', value: value.slice(cursor, match.index) });
    }
    parts.push({
      type: 'internalLink',
      value: match[0],
      data: {
        hName: 'a',
        hProperties: { href: '#', 'data-internal-link': match[0] },
        hChildren: [{ type: 'text', value: match[0] }],
      },
    });
    cursor = match.index + match[0].length;
  }
  if (cursor < value.length) {
    parts.push({ type: 'text', value: value.slice(cursor) });
  }
  return parts;
}

function normalizeTarget(value: string) {
  return value
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\.md$/i, '')
    .toLowerCase();
}

function fold(value: string) {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase();
}
