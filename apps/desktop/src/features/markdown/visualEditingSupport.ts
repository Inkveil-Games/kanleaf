export interface VisualEditingSupport {
  supported: boolean;
  reason?: string;
}

// Raw HTML stays editable visually: Milkdown keeps it as verbatim html nodes
// that render as text and serialize unchanged (see MilkdownRoundTrip tests).
export function visualEditingSupport(markdown: string): VisualEditingSupport {
  if (/^---\s*\n[\s\S]*?\n---\s*(?:\n|$)/.test(markdown)) {
    return {
      supported: false,
      reason: 'YAML frontmatter is safest to edit in Source mode.',
    };
  }
  const prose = markdown
    .replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\1[ \t]*$/gm, '')
    .replace(/(`+)[^\n]*?\1/g, '');
  if (/^\[\^[^\]]+\]:/m.test(prose) || /\[\^[^\]]+\]/.test(prose)) {
    return {
      supported: false,
      reason: 'Footnotes are safest to edit in Source mode.',
    };
  }
  return { supported: true };
}
