import type { Key } from "../i18n/index.ts";

/** What a shortcut does. */
export type ShortcutAction =
  | "palette"
  | "help"
  | "toggle-mode"
  | "back"
  | "forward"
  | "next-client"
  | "go-sessions"
  | "go-needs-you"
  | "go-projects"
  | "go-costs"
  | "go-settings";

export type ShortcutGroup = "general" | "navigation" | "tabs" | "lists" | "approvals";

/** One shortcut, for the cheat sheet and for the palette's hints. */
export interface ShortcutDef {
  id: string;
  /** The action the app runs; absent for a shortcut a screen handles itself (j, k, A, N). */
  action?: ShortcutAction;
  /** The keys in order. `Mod` is Ctrl, or ⌘ on a Mac. A chord is a letter then another letter. */
  keys: string[];
  /** A chord: the keys are pressed one after the other, not together. */
  chord?: boolean;
  label: Key;
  group: ShortcutGroup;
}

const def = (
  id: string,
  group: ShortcutGroup,
  keys: string[],
  label: Key,
  action?: ShortcutAction,
  chord = false,
): ShortcutDef => ({
  id,
  group,
  keys,
  label,
  ...(action ? { action } : {}),
  ...(chord ? { chord } : {}),
});

export const SHORTCUTS: ShortcutDef[] = [
  def("palette", "general", ["Mod", "K"], "shortcuts.palette", "palette"),
  def("help", "general", ["?"], "shortcuts.help", "help"),
  def("toggle-mode", "general", ["Mod", "Shift", "M"], "shortcuts.toggleMode", "toggle-mode"),
  def("next-client", "general", ["Alt", "Shift", "C"], "shortcuts.nextClient", "next-client"),
  def("back", "navigation", ["Alt", "←"], "shortcuts.back", "back"),
  def("forward", "navigation", ["Alt", "→"], "shortcuts.forward", "forward"),
  def("go-sessions", "navigation", ["g", "s"], "shortcuts.goSessions", "go-sessions", true),
  def("go-needs-you", "navigation", ["g", "n"], "shortcuts.goNeedsYou", "go-needs-you", true),
  def("go-projects", "navigation", ["g", "p"], "shortcuts.goProjects", "go-projects", true),
  def("go-costs", "navigation", ["g", "c"], "shortcuts.goCosts", "go-costs", true),
  def("go-settings", "navigation", ["g", ","], "shortcuts.goSettings", "go-settings", true),
  def("tab-new", "tabs", ["Mod", "T"], "shortcuts.tabNew"),
  def("tab-close", "tabs", ["Mod", "W"], "shortcuts.tabClose"),
  def("tab-next", "tabs", ["Mod", "Tab"], "shortcuts.tabNext"),
  def("tab-number", "tabs", ["Mod", "1…9"], "shortcuts.tabNumber"),
  def("list-next", "lists", ["j"], "shortcuts.listNext"),
  def("list-previous", "lists", ["k"], "shortcuts.listPrevious"),
  def("list-open", "lists", ["Enter"], "shortcuts.listOpen"),
  def("approve", "approvals", ["A"], "shortcuts.approve"),
  def("deny", "approvals", ["N"], "shortcuts.deny"),
  def("dismiss", "approvals", ["Esc"], "shortcuts.dismiss"),
];

/** The shortcut that runs `action`, if there is one. */
export function shortcutOf(action: ShortcutAction): ShortcutDef | undefined {
  return SHORTCUTS.find((s) => s.action === action);
}

/** How the keys read: `Ctrl+K`, `⌘K` on a Mac, `g p` for a chord. */
export function keysLabel(shortcut: ShortcutDef, mac: boolean): string {
  const keys = shortcut.keys.map((k) => (k === "Mod" ? (mac ? "⌘" : "Ctrl") : k));
  if (shortcut.chord) return keys.join(" ");
  // On a Mac the modifier sits against its key (⌘K); elsewhere keys are joined with a plus.
  return mac && shortcut.keys[0] === "Mod" ? keys.join("") : keys.join("+");
}

/** Whether the system is a Mac, where the shortcuts use ⌘ instead of Ctrl. */
export function isMac(nav: { platform?: string } | undefined): boolean {
  return /mac/i.test(nav?.platform ?? "");
}

/** The part of a key event the matcher reads. */
export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  /** Whether the event came from a text field. */
  typing: boolean;
}

export interface ChordState {
  /** The first key of a chord waiting for its second, or `null`. */
  pending: string | null;
  /** When it was pressed, in ms. */
  at: number;
}

export const CHORD_TIMEOUT_MS = 1500;

export const NO_CHORD: ChordState = { pending: null, at: 0 };

export interface ChordResult {
  state: ChordState;
  action: ShortcutAction | null;
  /** The key was part of a shortcut: the caller prevents its default. */
  consumed: boolean;
}

const MODIFIERS = new Set(["Shift", "Control", "Alt", "Meta"]);

/** One key press through the go-to chords (`g s`, `g n`, `g p`, `g c`, `g ,`) and `?`. */
export function chordStep(state: ChordState, event: KeyLike, now: number): ChordResult {
  const nothing = { state: NO_CHORD, action: null, consumed: false };
  if (event.typing || event.ctrlKey || event.metaKey || event.altKey) return nothing;
  if (MODIFIERS.has(event.key)) return { state, action: null, consumed: false };
  const waiting =
    state.pending !== null && now - state.at <= CHORD_TIMEOUT_MS ? state.pending : null;
  if (waiting !== null) {
    const second = SHORTCUTS.find(
      (s) => s.chord && s.action && s.keys[0] === waiting && s.keys[1] === event.key,
    );
    if (second?.action) return { state: NO_CHORD, action: second.action, consumed: true };
  }
  if (SHORTCUTS.some((s) => s.chord && s.keys[0] === event.key)) {
    return { state: { pending: event.key, at: now }, action: null, consumed: true };
  }
  const single = SHORTCUTS.find(
    (s) => !s.chord && s.action && s.keys.length === 1 && s.keys[0] === event.key,
  );
  if (single?.action) return { state: NO_CHORD, action: single.action, consumed: true };
  return nothing;
}
