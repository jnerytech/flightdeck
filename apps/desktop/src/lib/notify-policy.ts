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
  void prefs;
  void source;
  void now;
  return { os: true, bell: true, sound: true, fold: false };
}

/** The preferences, kept across starts on this computer. */
export class NotifyPreferences {
  value: NotifyPrefs = DEFAULT_NOTIFY_PREFS;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly storage: Platform["storage"]) {
    void this.storage;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  setEnabled(enabled: boolean): void {
    void enabled;
  }

  setEvent(event: SwitchableEvent, on: boolean): void {
    void event;
    void on;
  }

  setTeamFold(on: boolean): void {
    void on;
  }

  setSound(sound: Partial<SoundPrefs>): void {
    void sound;
  }

  muteHost(hostId: string, on: boolean): void {
    void hostId;
    void on;
  }

  muteProject(project: string, on: boolean): void {
    void project;
    void on;
  }

  muteSession(session: string, on: boolean): void {
    void session;
    void on;
  }

  /** The chosen sound file as a data URL, or null. */
  soundFile(): string | null {
    return null;
  }

  /** Keeps a chosen file (null clears it); false when it is too large to keep. */
  setSoundFile(name: string | null, dataUrl: string | null): boolean {
    void name;
    void dataUrl;
    return false;
  }

  /** Silences a session until `until` (ms); a time already past lifts it. */
  snooze(session: string, until: number): void {
    void session;
    void until;
  }

  /** Whether the session is muted or snoozed at `now`. */
  isQuiet(session: string, now: number): boolean {
    void session;
    void now;
    return false;
  }
}
