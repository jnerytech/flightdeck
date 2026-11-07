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

/** The part of a key event the page reads for its view keys. */
export interface ViewKey {
  key: string;
  code: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

/** How a session page gets its terminal: a shell in its folder, or the PTY of a launch. */
export type TerminalProp = { session: string } | { launch: string | null };

/** What a page knows when it works out which views it offers. */
export interface OfferedFlags {
  /** The host announces `review`. */
  enabled: boolean;
  files: boolean | undefined;
  telemetry: boolean | undefined;
  trace: boolean | undefined;
  claudeSessionId: string | null | undefined;
  messagingId: string | null | undefined;
  terminal: TerminalProp | undefined;
  /** The terminal id of a launched session, once found. */
  launched: string | null;
}

/** The views a page offers, in the order of `SESSION_VIEWS`. */
export function offeredViews(flags: OfferedFlags): SessionView[] {
  const named = !!flags.claudeSessionId;
  const offered: Record<SessionView, boolean> = {
    conversation: true,
    changes: flags.enabled && named,
    files: !!flags.files && named,
    time: !!flags.telemetry && named,
    trace: !!flags.trace && named,
    messages: !!flags.messagingId,
    terminal: !!flags.terminal && ("session" in flags.terminal || flags.launched !== null),
  };
  return SESSION_VIEWS.filter((view) => offered[view]);
}

/** The launch whose terminal the page follows, `null` for a shell in the folder or no terminal. */
export function terminalLaunch(terminal: TerminalProp | undefined): string | null {
  return terminal && "launch" in terminal ? terminal.launch : null;
}

/** The source the terminal view reads: a session's shell, a launched terminal, or none yet. */
export function terminalSourceOf(
  terminal: TerminalProp | undefined,
  launched: string | null,
): { session: string } | { terminalId: string } | null {
  if (terminal && "session" in terminal) return { session: terminal.session };
  return launched ? { terminalId: launched } : null;
}

/** The view a view key (Alt+digit, Ctrl+`) asks for, `null` when the key is not one of them. */
export function viewKeyTarget(
  event: ViewKey,
  views: readonly SessionView[],
  tab: SessionView,
): SessionView | null {
  if (event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) {
    if (event.key !== "`" || !views.includes("terminal")) return null;
    return tab === "terminal" ? "conversation" : "terminal";
  }
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null;
  // On a Mac Alt+1 types a symbol: the physical key says which digit it was.
  const digit = /^Digit(\d)$/.exec(event.code)?.[1] ?? (/^\d$/.test(event.key) ? event.key : "");
  return views[Number(digit) - 1] ?? null;
}

/** The index of the tab an arrow, Home or End key moves to, `-1` for any other key. */
export function tabKeyIndex(key: string, at: number, count: number): number {
  switch (key) {
    case "ArrowRight":
      return (at + 1) % count;
    case "ArrowLeft":
      return (at - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return -1;
  }
}
