import type { Node, ResolvedPos } from '@milkdown/kit/prose/model';

type BlockFilter = (pos: ResolvedPos, node: Node) => boolean;

/**
 * Hovering an inline atom such as an internal link resolves to that node;
 * rejecting it makes the block handle climb to the line's block. Hovered text
 * skips a nested container's first textblock (a list item's first line) for
 * its container, but the plugin only does that on its first step, so the
 * climb from an atom must reject that textblock too.
 */
export function blockHandleFilter(filterNodes: BlockFilter): BlockFilter {
  return (pos, node) =>
    !node.isInline &&
    !(node.isTextblock && pos.depth >= 1 && pos.index(pos.depth) === 0) &&
    filterNodes(pos, node);
}
