import type { Project } from "@flightdeck/protocol";

/**
 * Every project key the app has seen, from every host: what a project's label is told apart
 * against, so one project reads the same on every screen (issue #881).
 */
export class ProjectKeys {
  /** Moves whenever a new key is seen, so a screen can tell its labels may have changed. */
  version = 0;
  private readonly seen = new Set<string>();
  private readonly listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Remembers keys a screen has just read; nothing moves unless one is new. */
  note(keys: Iterable<string>): void {
    const before = this.seen.size;
    for (const key of keys) this.seen.add(key);
    if (this.seen.size === before) return;
    this.version += 1;
    for (const listener of this.listeners) listener();
  }

  all(): string[] {
    return [...this.seen];
  }
}

/** The keys of the projects the hosts list, which a host that does not send them leaves out. */
export function knownProjectKeys(projects: Record<string, readonly Project[]>): string[] {
  const keys = Object.values(projects).flatMap((list) =>
    list.flatMap((project) => (project.projectKey ? [project.projectKey] : [])),
  );
  return [...new Set(keys)];
}
