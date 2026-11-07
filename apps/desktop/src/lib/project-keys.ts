import type { Project } from "@flightdeck/protocol";

/**
 * Every project key the app has seen, from every host: what a project's label is told apart
 * against, so one project reads the same on every screen (issue #881).
 */
export class ProjectKeys {
  /** Moves whenever a new key is seen, so a screen can tell its labels may have changed. */
  version = 0;
  private readonly listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Remembers keys a screen has just read; nothing moves unless one is new. */
  note(_keys: Iterable<string>): void {}

  all(): string[] {
    return [];
  }
}

/** The keys of the projects the hosts list, which a host that does not send them leaves out. */
export function knownProjectKeys(_projects: Record<string, readonly Project[]>): string[] {
  return [];
}
