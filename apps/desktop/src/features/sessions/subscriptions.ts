/** The open session: a host and, once one is picked, a session on it. */
export interface OpenSession {
  hostId: string;
  sessionId: string | null;
}

/** What the subscriptions read and ask through the app's store. */
export interface SessionSubscriptionsCore {
  /** The session open on screen, if any. */
  selected(): OpenSession | null;
  /** Opens another session (or none on that host). */
  setSelected(selected: OpenSession): void;
  /** Asks a host for a session's full event stream. */
  subscribe(hostId: string, sessionId: string): void;
  /** Tells a host the app no longer needs a session's full event stream. */
  unsubscribe(hostId: string, sessionId: string): void;
}

/**
 * Which sessions keep a subscription to their full event stream (#1596: a slice of the store): the
 * open one, and the ones followed without being open (the project page's tiles), counted per
 * follower. A session leaves only when neither holds it. A host that connects later subscribes what
 * `selected()` and `followed()` name; that replay stays in `HostLink`.
 */
export class SessionSubscriptions {
  /** Sessions followed without being open, by `host/session` key, with how many follow each. */
  private readonly watched = new Map<string, number>();

  constructor(private readonly core: SessionSubscriptionsCore) {}

  /** Selects a session: only the open one keeps a subscription to its full event stream. */
  select(hostId: string, sessionId: string | null): void {
    const previous = this.core.selected();
    if (
      previous?.sessionId &&
      previous.sessionId !== sessionId &&
      !this.watched.has(`${previous.hostId}/${previous.sessionId}`)
    ) {
      this.core.unsubscribe(previous.hostId, previous.sessionId);
    }
    if (sessionId) this.core.subscribe(hostId, sessionId);
    this.core.setSelected({ hostId, sessionId });
  }

  /**
   * Follows a session's full event stream without opening it, for as long as the returned function
   * has not been called (the tiles of a project follow several at once).
   */
  watchSession(hostId: string, sessionId: string): () => void {
    const key = `${hostId}/${sessionId}`;
    this.watched.set(key, (this.watched.get(key) ?? 0) + 1);
    this.core.subscribe(hostId, sessionId);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const left = (this.watched.get(key) ?? 1) - 1;
      if (left > 0) {
        this.watched.set(key, left);
        return;
      }
      this.watched.delete(key);
      const open = this.core.selected();
      if (open?.hostId === hostId && open.sessionId === sessionId) return;
      this.core.unsubscribe(hostId, sessionId);
    };
  }

  /** The followed sessions' `host/session` keys, for a host that connects later. */
  followed(): Iterable<string> {
    return this.watched.keys();
  }
}
