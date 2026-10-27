import type { InternalLinkIndex } from './internalLinks';

export interface InternalLinkTrigger {
  /** Document position where the typed `[[` starts. */
  from: number;
  query: string;
  rect: { left: number; top: number; bottom: number };
  insert: (target: string) => void;
}

export interface InternalLinkEdit {
  raw: string;
  rect: { left: number; top: number; bottom: number };
  /** Replaces the link; `null` unlinks it and keeps its visible text. */
  setRaw: (raw: string | null) => void;
  /** Returns focus to the editor without changing the link. */
  dismiss: () => void;
}

export const INTERNAL_LINK_TRIGGER = /\[\[([^[\]\n|#]{0,80})$/;

/**
 * Bridges an editor (Milkdown or CodeMirror) and the shared link picker. The
 * owner assigns the callbacks; editors read them at event time, so the
 * controller instance can stay stable across renders.
 */
export class InternalLinkController {
  index: InternalLinkIndex | null = null;
  onTrigger: (trigger: InternalLinkTrigger | null) => void = () => undefined;
  onKey: (key: string) => boolean = () => false;
  onOpen: (raw: string) => void = () => undefined;
  onEdit: (edit: InternalLinkEdit) => void = () => undefined;
  private readonly listeners = new Set<() => void>();

  setHandlers(handlers: {
    onTrigger: InternalLinkController['onTrigger'];
    onKey: InternalLinkController['onKey'];
    onOpen: InternalLinkController['onOpen'];
    onEdit: InternalLinkController['onEdit'];
  }) {
    this.onTrigger = handlers.onTrigger;
    this.onKey = handlers.onKey;
    this.onOpen = handlers.onOpen;
    this.onEdit = handlers.onEdit;
  }

  setIndex(index: InternalLinkIndex | null) {
    if (index === this.index) return;
    this.index = index;
    this.listeners.forEach((listener) => listener());
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
