/** The views of a session's page, in the order the keys and the palette number them. */
export const SESSION_VIEWS = [
  "conversation",
  "changes",
  "files",
  "time",
  "trace",
  "messages",
] as const;
export type SessionView = (typeof SESSION_VIEWS)[number];

/** What the page on screen offers: which views it has, and how to show one. */
export interface SessionViewsEntry {
  /** Which session tab it is (`<host>/<session>`): the views it remembers are kept under it. */
  key: string;
  views: readonly SessionView[];
  select(view: SessionView): void;
}

/**
 * Issue #107: the view each session tab was last on, and the page now on screen, so the keys and the
 * palette can switch its view without the screen being in their hands.
 */
export class SessionViews {
  /** The view `key` was last on, or `null` when it has none yet. */
  last(_key: string): SessionView | null {
    return null;
  }

  remember(_key: string, _view: SessionView): void {}

  /** Puts `entry` on screen; the returned function takes it off (only if it is still the one). */
  register(_entry: SessionViewsEntry): () => void {
    return () => {};
  }

  /** The views of the page on screen, none when there is no such page. */
  available(): readonly SessionView[] {
    return [];
  }

  /** Shows `view` on the page on screen; false when there is no such page or it lacks the view. */
  select(_view: SessionView): boolean {
    return false;
  }
}
