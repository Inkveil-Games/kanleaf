import type { LucideProps } from 'lucide-react';
import { createElement } from 'react';
import { projectIcon } from './projectIcons';

export function ProjectIconGlyph({
  name,
  ...props
}: { name: string } & Omit<LucideProps, 'ref'>) {
  return createElement(projectIcon(name), props);
}
