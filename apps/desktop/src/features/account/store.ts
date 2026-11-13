import type { AccountState } from "@flightdeck/protocol";

/** The Claude accounts' part of the app's state (#1596): the account each host's `claude` is signed in to. */
export interface AccountSliceState {
  /** The Claude account each host is signed in to, by host id (phase 34); only hosts being looked at. */
  account: Record<string, AccountState>;
}

/** A fresh initial state for each store: its record is never shared between stores. */
export const initialAccountState = (): AccountSliceState => ({ account: {} });

/** A host's account, on the connection the host had when the stream was asked for. */
export interface AccountStream {
  /** Turns the host's account stream on or off. */
  watch(on: boolean): void;
  /** What the host already knows (`account.get`); rejects when the host cannot answer. */
  get(): Promise<AccountState>;
}

/** What the accounts read and ask through the app's store. */
export interface AccountCore {
  state(): AccountSliceState;
  update(patch: Partial<AccountSliceState>): void;
  /** The host's account stream; undefined while the host has no connection. */
  stream(hostId: string): AccountStream | undefined;
  /** Asks the host to read its account again (`account.refresh`); null when it refuses. */
  refresh(hostId: string): Promise<AccountState | null>;
}

/** The Claude account of each host, shown and never asked for (phase 34; #1596: a slice of the store). */
export class AccountSlice {
  /** The cards watching each host: the stream goes off when the last one stops (#1752). */
  private readonly watchers = new Map<string, Set<symbol>>();
  /** The stream each host's watchers switched on: the last stop switches off that one. */
  private readonly streams = new Map<string, AccountStream>();
  /** Bumped when a host is removed: an answer that was on its way must not write back. */
  private readonly removals = new Map<string, number>();

  constructor(private readonly core: AccountCore) {}

  /** Starts the host's account stream while its card is on screen; returns the function that ends it. */
  watch(hostId: string): () => void {
    const me = Symbol(hostId);
    const mine = this.watchers.get(hostId) ?? new Set<symbol>();
    mine.add(me);
    this.watchers.set(hostId, mine);
    // The stop ends the stream it started: a connection that comes later is not its to switch off.
    const stream = this.core.stream(hostId);
    if (stream) this.streams.set(hostId, stream);
    stream?.watch(true);
    // What the host already knows comes at once; its first read follows through the stream.
    void stream?.get().then(
      (state) => {
        if (mine.has(me)) this.updated(hostId, state);
      },
      () => {},
    );
    return () => {
      if (!mine.delete(me) || mine.size > 0) return;
      this.watchers.delete(hostId);
      const on = this.streams.get(hostId);
      this.streams.delete(hostId);
      on?.watch(false);
    };
  }

  /** Drops what a removed host left: its account and the watchers it had (#1752). */
  forget(hostId: string): void {
    this.removals.set(hostId, (this.removals.get(hostId) ?? 0) + 1);
    this.watchers.get(hostId)?.clear();
    this.watchers.delete(hostId);
    this.streams.delete(hostId);
    const { [hostId]: _gone, ...rest } = this.core.state().account;
    this.core.update({ account: rest });
  }

  /** Asks the host to read its account again now; `false` when it refused (the banner says why). */
  async refresh(hostId: string): Promise<boolean> {
    const removals = this.removals.get(hostId);
    const state = await this.core.refresh(hostId);
    if (state && this.removals.get(hostId) === removals) this.updated(hostId, state);
    return state !== null;
  }

  /** Keeps the account a host reported, whether it was asked for or came through the stream. */
  updated(hostId: string, state: AccountState): void {
    this.core.update({ account: { ...this.core.state().account, [hostId]: state } });
  }
}
