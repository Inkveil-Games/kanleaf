import { useEffect, useRef } from 'react';
import { createMermaidPreview, mountMermaidPreviews } from './mermaidPreview';

export function MermaidDiagram({ source }: { source: string }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = createMermaidPreview(source);
    const container = root.current;
    if (container) {
      container.replaceChildren(element);
      mountMermaidPreviews(container);
    }
    return () => element.remove();
  }, [source]);
  return <div ref={root} />;
}
