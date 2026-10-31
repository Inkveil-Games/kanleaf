const FALLBACK_LINE_HEIGHT = 32;

/**
 * The block's first text line, used as the handle's anchor so the handle is
 * centered on what the reader sees first. Crepe anchors tall blocks to their
 * top edge instead, which sits above the text of padded rows such as
 * checklist items.
 */
export function firstLineRect(block: HTMLElement): Omit<DOMRect, 'toJSON'> {
  const blockRect = block.getBoundingClientRect();
  const line = block.matches('p, h1, h2, h3, h4, h5, h6')
    ? block
    : block.querySelector<HTMLElement>('p, h1, h2, h3, h4, h5, h6');
  let top = blockRect.top;
  let height = Math.min(blockRect.height, FALLBACK_LINE_HEIGHT);
  if (line) {
    const lineRect = line.getBoundingClientRect();
    const style = getComputedStyle(line);
    const paddingTop = Number.parseFloat(style.paddingTop) || 0;
    const lineHeight = Number.parseFloat(style.lineHeight);
    top = lineRect.top + paddingTop;
    height = Math.min(
      Number.isFinite(lineHeight) ? lineHeight : lineRect.height,
      Math.max(lineRect.height - paddingTop, 0),
    );
  }
  return {
    x: blockRect.left,
    y: top,
    left: blockRect.left,
    right: blockRect.right,
    width: blockRect.width,
    top,
    bottom: top + height,
    height,
  };
}
