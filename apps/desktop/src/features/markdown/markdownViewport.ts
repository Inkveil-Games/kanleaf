import { editorViewCtx, remarkCtx } from '@milkdown/kit/core';
import type { Ctx } from '@milkdown/kit/ctx';

export interface MarkdownViewport {
  offset: number;
  inset: number;
}

export interface MarkdownEditorHandle {
  captureViewport: () => MarkdownViewport | null;
}

function visualBlocks(ctx: Ctx, markdown: string) {
  // Read positions before remark transforms math/images into editor nodes.
  const ranges = ctx
    .get(remarkCtx)
    .parse(markdown)
    .children.filter((node) => node.type !== 'definition');
  const view = ctx.get(editorViewCtx);
  const blocks: { element: HTMLElement; from: number; to: number }[] = [];
  let index = 0;
  view.state.doc.forEach((node, position) => {
    // Empty editing paragraphs have no persisted Markdown block identity.
    if (node.type.name === 'paragraph' && !node.content.size) return;
    const range = ranges[index++]?.position;
    const element = view.nodeDOM(position);
    if (range && element instanceof HTMLElement)
      blocks.push({
        element,
        from: range.start.offset ?? 0,
        to: range.end.offset ?? markdown.length,
      });
  });
  return blocks;
}

export function captureMilkdownViewport(
  ctx: Ctx,
  root: HTMLElement,
  markdown: string,
): MarkdownViewport {
  const top = root.getBoundingClientRect().top;
  for (const block of visualBlocks(ctx, markdown)) {
    const box = block.element.getBoundingClientRect();
    if (box.bottom <= top) continue;
    const fraction = Math.max(
      0,
      Math.min(1, (top - box.top) / Math.max(1, box.height)),
    );
    return {
      offset: block.from + Math.round((block.to - block.from) * fraction),
      inset: Math.max(0, box.top - top),
    };
  }
  return { offset: markdown.length, inset: 0 };
}

export function restoreMilkdownViewport(
  ctx: Ctx,
  root: HTMLElement,
  markdown: string,
  anchor: MarkdownViewport,
) {
  const blocks = visualBlocks(ctx, markdown);
  const block =
    blocks.find((item) => item.to >= anchor.offset) ?? blocks.at(-1);
  if (!block) return () => {};
  const fraction = Math.max(
    0,
    Math.min(
      1,
      (anchor.offset - block.from) / Math.max(1, block.to - block.from),
    ),
  );
  let frame = 0;
  const restore = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const box = block.element.getBoundingClientRect();
      root.scrollTop +=
        box.top +
        box.height * fraction -
        root.getBoundingClientRect().top -
        anchor.inset;
    });
  };
  // Images and virtualized diagrams can finish layout after the tab mounts.
  // Keep the source anchor steady only until the user takes over scrolling.
  const observer = new ResizeObserver(restore);
  observer.observe(ctx.get(editorViewCtx).dom);
  const events = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;
  const stop = () => {
    cancelAnimationFrame(frame);
    observer.disconnect();
    events.forEach((event) => root.removeEventListener(event, stop));
  };
  events.forEach((event) =>
    root.addEventListener(event, stop, { passive: true }),
  );
  restore();
  return stop;
}
