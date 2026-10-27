import { useContext, useEffect, useMemo, useRef, type RefObject } from 'react';
import {
  DocumentOutlineContext,
  markdownHeadings,
  type OutlineHeading,
} from './documentOutline';
import type { MarkdownEditorHandle } from './markdownViewport';

const PREVIEW_HEADINGS = '.markdown-preview :is(h1, h2, h3, h4, h5, h6)';
const ACTIVE_THRESHOLD = 24;
const USER_SCROLL_EVENTS = ['wheel', 'touchstart', 'keydown'] as const;

/**
 * Publishes the open note's headings to the Library outline and keeps the
 * reader's current heading in sync. The editors map source offsets to their
 * own layout; the read-only preview has no editor, so its headings are matched
 * by document order.
 */
export function useDocumentOutline({
  draft,
  mode,
  editorRef,
  scrollHostRef,
}: {
  draft: string;
  mode: 'editor' | 'source' | 'preview';
  editorRef: RefObject<MarkdownEditorHandle | null>;
  scrollHostRef: RefObject<HTMLElement | null>;
}) {
  const outline = useContext(DocumentOutlineContext);
  const headings = useMemo(() => markdownHeadings(draft), [draft]);
  const headingsRef = useRef(headings);
  // A heading picked from the outline stays current while the note cannot
  // scroll it any higher (a short note, or one near the end), until the
  // reader scrolls on their own.
  const revealedRef = useRef<number | null>(null);

  useEffect(() => {
    headingsRef.current = headings;
  }, [headings]);

  useEffect(() => {
    if (!outline) return;
    const host = scrollHostRef.current;
    let frame = 0;
    let scroller: HTMLElement | null = null;

    const previewElements = () =>
      host
        ? Array.from(host.querySelectorAll<HTMLElement>(PREVIEW_HEADINGS))
        : [];

    const viewportOffset = () => {
      if (mode !== 'preview')
        return editorRef.current?.captureViewport()?.offset ?? null;
      if (!host) return null;
      const top = host.getBoundingClientRect().top + ACTIVE_THRESHOLD;
      let active: number | null = null;
      for (const [index, element] of previewElements().entries()) {
        if (element.getBoundingClientRect().top > top) break;
        active = headingsRef.current[index]?.offset ?? active;
      }
      return active;
    };
    const measure = () => {
      const offset = viewportOffset();
      const revealed = revealedRef.current;
      const atEnd =
        scroller !== null &&
        scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
      outline.setActive(
        revealed !== null && atEnd && (offset ?? -1) < revealed
          ? revealed
          : offset,
      );
    };
    const schedule = (event?: Event) => {
      if (event?.target instanceof HTMLElement) scroller = event.target;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    const release = () => {
      revealedRef.current = null;
    };

    const reveal = (heading: OutlineHeading) => {
      revealedRef.current = heading.offset;
      outline.setActive(heading.offset);
      if (mode !== 'preview') {
        editorRef.current?.revealOffset(heading.offset);
        return;
      }
      const index = headingsRef.current.findIndex(
        (item) => item.offset === heading.offset,
      );
      previewElements()[index]?.scrollIntoView({ block: 'start' });
    };

    outline.publish(headings, reveal);
    schedule();
    // Scroll events do not bubble, so listen in the capture phase for
    // whichever element inside the host owns scrolling in this mode.
    host?.addEventListener('scroll', schedule, {
      capture: true,
      passive: true,
    });
    for (const type of USER_SCROLL_EVENTS)
      host?.addEventListener(type, release, { capture: true, passive: true });
    return () => {
      cancelAnimationFrame(frame);
      host?.removeEventListener('scroll', schedule, { capture: true });
      for (const type of USER_SCROLL_EVENTS)
        host?.removeEventListener(type, release, { capture: true });
    };
  }, [editorRef, headings, mode, outline, scrollHostRef]);

  useEffect(() => {
    if (!outline) return;
    return () => outline.clear();
  }, [outline]);
}
