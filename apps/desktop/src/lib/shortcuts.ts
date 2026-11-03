import type { Key } from "../i18n/index.ts";

/** What a shortcut does. */
export type ShortcutAction =
  | "palette"
  | "help"
  | "back"
  | "forward"
  | "next-client"
  | "go-sessions"
  | "go-needs-you"
  | "go-projects"
  | "go-costs"
  | "go-settings";

export type ShortcutGroup = "general" | "navigation" | "lists" | "approvals";

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

export const SHORTCUTS: ShortcutDef[] = [];

/** The shortcut that runs `action`, if there is one. */
export function shortcutOf(_action: ShortcutAction): ShortcutDef | undefined {
  return undefined;
}

/** How the keys read: `Ctrl+K`, `⌘K` on a Mac, `g then s` for a chord. */
export function keysLabel(_def: ShortcutDef, _mac: boolean): string {
  return "";
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

/** One key press through the go-to chords (`g s`, `g n`, `g p`, `g c`, `,`) and `?`. */
export function chordStep(state: ChordState, _event: KeyLike, _now: number): ChordResult {
  return { state, action: null, consumed: false };
}
