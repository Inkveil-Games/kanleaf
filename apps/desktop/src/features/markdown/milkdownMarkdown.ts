import { $remark } from '@milkdown/kit/utils';

interface MarkdownAstNode {
  type?: string;
  title?: string | null;
  children?: MarkdownAstNode[];
}

function normalizeImageTitles(tree: MarkdownAstNode) {
  if (tree.type === 'image-block') {
    // Crepe's block image schema treats Markdown alt text as a resize ratio.
    // Use its standard inline image schema so ordinary images keep their alt
    // text and optional title, including when they occupy a whole paragraph.
    tree.children = [{ ...tree, type: 'image', title: tree.title ?? '' }];
    tree.type = 'paragraph';
  }
  if (tree.type === 'image' && tree.title === null) tree.title = '';
  tree.children?.forEach(normalizeImageTitles);
}

// Milkdown 7.22 validates image titles as strings, while mdast represents an
// omitted title as null. Normalize that boundary so ordinary Markdown images
// cannot be dropped when the visual editor parses a document.
export const normalizeMilkdownImageTitles = $remark(
  'kanleafNormalizeImageTitles',
  () => () => normalizeImageTitles,
);
