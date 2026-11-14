import type { Platform } from "../../platform/types.ts";
import {
  clamp,
  NOTIFY_PREFS_KEY,
  NOTIFY_SOUND_KEY,
  type NotifyPrefs,
  readPrefs,
  SOUND_FILE_MAX,
  type SoundPrefs,
  type SwitchableEvent,
  toggle,
} from "./domain/notify-policy.ts";

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
    const stored = this.storage.getItem(NOTIFY_SOUND_KEY);
    // Only what this app wrote: a stored URL of any other kind is never loaded.
    return stored?.startsWith("data:audio/") ? stored : null;
  }

  /** Keeps a chosen file (null clears it); false when it is too large to keep or the storage is full. */
  setSoundFile(name: string | null, dataUrl: string | null): boolean {
    if (dataUrl !== null && dataUrl.length > SOUND_FILE_MAX) return false;
    try {
      this.storage.setItem(NOTIFY_SOUND_KEY, dataUrl ?? "");
    } catch {
      // The storage is full: the old sound stays.
      return false;
    }
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
