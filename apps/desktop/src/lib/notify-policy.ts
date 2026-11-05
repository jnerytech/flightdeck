import type { Platform } from "../platform/types.ts";

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
const SOUND_FILE_MAX = 600_000;

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
const bool = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback);
const clamp = (n: number) => Math.min(1, Math.max(0, n));

/** The stored preferences, field by field: whatever is unreadable falls back to its default. */
function readPrefs(raw: string | null): NotifyPrefs {
  let stored: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(raw ?? "{}");
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      stored = parsed as Record<string, unknown>;
    }
  } catch {
    // Not JSON: the defaults.
  }
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

const toggle = (list: string[], item: string, on: boolean) =>
  on ? [...list.filter((other) => other !== item), item] : list.filter((other) => other !== item);

/** The preferences, kept across starts on this computer. */
export class NotifyPreferences {
  value: NotifyPrefs;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly storage: Platform["storage"]) {
    this.value = readPrefs(storage.getItem(NOTIFY_PREFS_KEY));
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  setEnabled(enabled: boolean): void {
    this.change({ enabled });
  }

  setEvent(event: SwitchableEvent, on: boolean): void {
    this.change({ events: { ...this.value.events, [event]: on } });
  }

  setTeamFold(on: boolean): void {
    this.change({ teamFold: on });
  }

  setSound(sound: Partial<SoundPrefs>): void {
    const next = { ...this.value.sound, ...sound };
    this.change({ sound: { ...next, volume: clamp(next.volume) } });
  }

  muteHost(hostId: string, on: boolean): void {
    this.change({ mutedHosts: toggle(this.value.mutedHosts, hostId, on) });
  }

  muteProject(project: string, on: boolean): void {
    this.change({ mutedProjects: toggle(this.value.mutedProjects, project, on) });
  }

  muteSession(session: string, on: boolean): void {
    this.change({ mutedSessions: toggle(this.value.mutedSessions, session, on) });
  }

  /** The chosen sound file as a data URL, or null. */
  soundFile(): string | null {
    return this.storage.getItem(NOTIFY_SOUND_KEY) || null;
  }

  /** Keeps a chosen file (null clears it); false when it is too large to keep. */
  setSoundFile(name: string | null, dataUrl: string | null): boolean {
    if (dataUrl !== null && dataUrl.length > SOUND_FILE_MAX) return false;
    this.storage.setItem(NOTIFY_SOUND_KEY, dataUrl ?? "");
    this.change({
      sound: { ...this.value.sound, fileName: name, ...(name ? { mode: "file" as const } : {}) },
    });
    return true;
  }

  /** Silences a session until `until` (ms); a time already past lifts it. */
  snooze(session: string, until: number, now: number): void {
    const { [session]: _old, ...rest } = this.value.snoozed;
    this.change({ snoozed: until > now ? { ...rest, [session]: until } : rest });
  }

  /** Whether the session is muted or snoozed at `now`. */
  isQuiet(session: string, now: number): boolean {
    return this.value.mutedSessions.includes(session) || (this.value.snoozed[session] ?? 0) > now;
  }

  private change(patch: Partial<NotifyPrefs>): void {
    this.value = { ...this.value, ...patch };
    this.storage.setItem(NOTIFY_PREFS_KEY, JSON.stringify(this.value));
    for (const listener of this.listeners) listener();
  }
}
