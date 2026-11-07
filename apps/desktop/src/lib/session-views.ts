import type { Key } from "../i18n/index.ts";

/** The views of a session's page, in the order the keys and the palette number them. */
export const SESSION_VIEWS = [
  "conversation",
  "changes",
  "files",
  "time",
  "trace",
  "messages",
  "terminal",
] as const;
export type SessionView = (typeof SESSION_VIEWS)[number];

/** The dictionary key that names each view. */
export const VIEW_LABEL: Record<SessionView, Key> = {
  conversation: "changes.conversationTab",
  changes: "changes.tab",
  files: "files.tab",
  time: "telemetry.tab",
  trace: "trace.tab",
  messages: "sessionMessages.tab",
  terminal: "sessionViews.terminal",
};

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
  private readonly lastViews = new Map<string, SessionView>();
  private readonly terminals = new Map<string, string>();
  private current: SessionViewsEntry | null = null;

  /** The view `key` was last on, or `null` when it has none yet. */
  last(key: string): SessionView | null {
    return this.lastViews.get(key) ?? null;
  }

  remember(key: string, view: SessionView): void {
    this.lastViews.set(key, view);
  }

  /** The shell this tab opened (`terminalId`), so a page that comes back finds it; `null` when none. */
  terminalOf(key: string): string | null {
    return this.terminals.get(key) ?? null;
  }

  setTerminal(key: string, terminalId: string | null): void {
    if (terminalId === null) this.terminals.delete(key);
    else this.terminals.set(key, terminalId);
  }

  /** Puts `entry` on screen; the returned function takes it off (only if it is still the one). */
  register(entry: SessionViewsEntry): () => void {
    this.current = entry;
    return () => {
      if (this.current === entry) this.current = null;
    };
  }

  /** The views of the page on screen, none when there is no such page. */
  available(): readonly SessionView[] {
    return this.current?.views ?? [];
  }

  /** Shows `view` on the page on screen; false when there is no such page or it lacks the view. */
  select(view: SessionView): boolean {
    if (!this.current?.views.includes(view)) return false;
    this.current.select(view);
    return true;
  }
}
