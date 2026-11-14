import { z } from "zod";
import { parseJsonText } from "@/shared/lib/index.ts";

/** What a notification is about; each of the first five has its own switch. */
export type NotifyEvent =
  | "needs-you"
  | "turn-finished"
  | "session-failed"
  | "pr-watch"
  | "budget-quota"
  | "other";

export const SWITCHABLE = [
  "needs-you",
  "turn-finished",
  "session-failed",
  "pr-watch",
  "budget-quota",
] as const;
export type SwitchableEvent = (typeof SWITCHABLE)[number];

export interface SoundPrefs {
  mode: "off" | "system" | "file";
  /** 0 to 1. */
  volume: number;
  /** The name of the chosen file, for the settings to show. */
  fileName: string | null;
}

/** What the person chose about notifications on this computer. */
export interface NotifyPrefs {
  /** The OS notifications and the sound; the bell keeps its entries. */
  enabled: boolean;
  events: Record<SwitchableEvent, boolean>;
  mutedHosts: string[];
  /** `hostId/projectId`. */
  mutedProjects: string[];
  /** A session key: `hostId/sessionId`, or `hostId/claudeSessionId` for a terminal session. */
  mutedSessions: string[];
  /** Session key to the time (ms) its snooze ends. */
  snoozed: Record<string, number>;
  /** A team's workers finishing close together send one message. */
  teamFold: boolean;
  sound: SoundPrefs;
}

export const DEFAULT_NOTIFY_PREFS: NotifyPrefs = {
  enabled: true,
  events: {
    "needs-you": true,
    "turn-finished": true,
    "session-failed": true,
    "pr-watch": true,
    "budget-quota": true,
  },
  mutedHosts: [],
  mutedProjects: [],
  mutedSessions: [],
  snoozed: {},
  teamFold: true,
  sound: { mode: "off", volume: 0.5, fileName: null },
};

/** Where a notification comes from, as the rules need to know it. */
export interface NotifySource {
  event: NotifyEvent;
  hostId?: string;
  /** `hostId/projectId`. */
  project?: string;
  session?: string;
  /** The session is a worker of a team. */
  worker?: boolean;
}

export interface NotifyDecision {
  /** The operating system's notification. */
  os: boolean;
  /** An entry in the bell's panel. */
  bell: boolean;
  /** The sound. */
  sound: boolean;
  /** A worker's turn that waits to be folded into its team's one message. */
  fold: boolean;
}

/** The rules, in one place: who gets told, where, for one notification at `now`. */
export function decide(prefs: NotifyPrefs, source: NotifySource, now: number): NotifyDecision {
  const quiet =
    (source.hostId !== undefined && prefs.mutedHosts.includes(source.hostId)) ||
    (source.project !== undefined && prefs.mutedProjects.includes(source.project)) ||
    (source.session !== undefined &&
      (prefs.mutedSessions.includes(source.session) || (prefs.snoozed[source.session] ?? 0) > now));
  // A muted source is not told at all; a blocked permission is still state, in Needs you.
  if (quiet) return { os: false, bell: false, sound: false, fold: false };
  if (source.event !== "other" && !prefs.events[source.event]) {
    return { os: false, bell: false, sound: false, fold: false };
  }
  return {
    os: prefs.enabled,
    bell: true,
    sound: prefs.enabled,
    fold: source.event === "turn-finished" && source.worker === true && prefs.teamFold,
  };
}

export const NOTIFY_PREFS_KEY = "flightdeck.notifyPrefs";
export const NOTIFY_SOUND_KEY = "flightdeck.notifySoundFile";
/** The largest sound file kept (as a data URL): it lives in the app's own storage. */
export const SOUND_FILE_MAX = 600_000;
/** The largest file read before it is turned into that data URL (base64 adds a third). */
export const SOUND_FILE_MAX_BYTES = 440_000;

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
const bool = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback);
export const clamp = (n: number) => Math.min(1, Math.max(0, n));

/** The stored preferences, field by field: whatever is unreadable falls back to its default. */
export function readPrefs(raw: string | null): NotifyPrefs {
  const stored = parseJsonText(raw ?? "{}", z.record(z.string(), z.unknown()), {});
  const defaults = DEFAULT_NOTIFY_PREFS;
  const events = (stored.events ?? {}) as Record<string, unknown>;
  const sound = (stored.sound ?? {}) as Record<string, unknown>;
  const snoozed = Object.fromEntries(
    Object.entries((stored.snoozed ?? {}) as Record<string, unknown>).filter(
      (entry): entry is [string, number] => typeof entry[1] === "number",
    ),
  );
  return {
    enabled: bool(stored.enabled, defaults.enabled),
    events: Object.fromEntries(
      SWITCHABLE.map((event) => [event, bool(events[event], defaults.events[event])]),
    ) as NotifyPrefs["events"],
    mutedHosts: strings(stored.mutedHosts),
    mutedProjects: strings(stored.mutedProjects),
    mutedSessions: strings(stored.mutedSessions),
    snoozed,
    teamFold: bool(stored.teamFold, defaults.teamFold),
    sound: {
      mode: sound.mode === "system" || sound.mode === "file" ? sound.mode : "off",
      volume: typeof sound.volume === "number" ? clamp(sound.volume) : defaults.sound.volume,
      fileName: typeof sound.fileName === "string" ? sound.fileName : null,
    },
  };
}

export const toggle = (list: string[], item: string, on: boolean) =>
  on ? [...list.filter((other) => other !== item), item] : list.filter((other) => other !== item);
