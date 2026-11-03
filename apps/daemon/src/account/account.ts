import type { AccountState, AccountStatus } from "@flightdeck/protocol";
import { FlightdeckError } from "../errors.ts";
import type { Quota, Timers } from "../quota/quota.ts";
import type { AccountInfoReading, AuthStatus, UsageReading } from "./readers.ts";

/** What the service asks; the daemon wires the real ones, tests wire fakes. */
export interface AccountReaders {
  status(): Promise<AuthStatus | null>;
  sdk(): Promise<{ info: AccountInfoReading | null; usage: UsageReading }>;
}

export interface AccountOptions {
  quota: Quota;
  readers: AccountReaders;
  /** Milliseconds now. */
  now?: () => number;
  timers?: Timers;
}

const LOGIN_COMMAND = "claude auth login";

/** While somebody watches, the account is read this often (the stream only covers turns). */
export const POLL_MS = 5 * 60_000;
/** A person's refresh is refused when the last read started less than this ago. */
export const REFRESH_FLOOR_MS = 30_000;

const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** The empty reading a host has before the first read. */
const EMPTY: AccountState = {
  status: "unknown",
  name: null,
  organization: null,
  plan: null,
  provider: null,
  windows: [],
  readAt: null,
  stale: false,
  error: null,
  source: "status",
  loginCommand: LOGIN_COMMAND,
};

/** What `claude auth status` says about how the host is signed in. */
function statusOfAuth(auth: AuthStatus): AccountStatus {
  if (auth.loggedIn === false) return "signed_out";
  switch (auth.authMethod) {
    case "claude.ai":
      return "signed_in";
    // An API key, or a token for a gateway: no plan, no windows.
    case "api_key":
    case "oauth_token":
      return "api_key";
    case "third_party":
      return "third_party";
    default:
      return "unknown";
  }
}

/** With no status to go by, what the SDK's account info says. */
function statusOfInfo(info: AccountInfoReading | null): AccountStatus {
  if (info === null) return "unknown";
  if (info.email !== null) return "signed_in";
  if (info.apiKeySource !== null) return "api_key";
  return info.tokenSource === "none" ? "signed_out" : "unknown";
}

/**
 * The Claude account of the host: what its own `claude` says about who is signed in and the plan
 * windows. Holds the last reading in memory only; the windows go through the host's `Quota`, so the
 * card, the queue and the status line read the same numbers.
 */
export class Account {
  private readonly now: () => number;
  private readonly timers: Timers;
  private last: AccountState = EMPTY;
  private readonly watchers = new Set<(state: AccountState) => void>();
  private inflight: Promise<AccountState> | null = null;
  private lastStart: number | null = null;
  private timer: unknown = null;
  private stopQuota: (() => void) | null = null;

  constructor(private readonly opts: AccountOptions) {
    this.now = opts.now ?? Date.now;
    this.timers = opts.timers ?? realTimers;
  }

  /** The last reading, with the windows still valid now. */
  state(): AccountState {
    const shows = this.last.status === "signed_in" || this.last.status === "unknown";
    return { ...this.last, windows: shows ? this.opts.quota.windows() : [] };
  }

  /**
   * Gets the state after each read and each change of the windows. The first watcher starts the
   * reading (once now, then every 5 minutes); the last one to leave stops it.
   */
  watch(listener: (state: AccountState) => void): () => void {
    this.watchers.add(listener);
    if (this.watchers.size === 1) {
      this.stopQuota = this.opts.quota.watch(() => {
        // A read records its windows and then pushes once, itself.
        if (this.inflight === null) this.notify();
      });
      void this.readNow();
    }
    return () => {
      this.watchers.delete(listener);
      if (this.watchers.size > 0) return;
      this.stopQuota?.();
      this.stopQuota = null;
      this.disarm();
    };
  }

  /** A managed session ended a turn: its stream has just refreshed the windows, so read again. */
  turnEnded(): void {
    if (this.watchers.size > 0) void this.readNow();
  }

  /** A person asked for a read now; refused when the last one started under 30 seconds ago. */
  async refresh(): Promise<AccountState> {
    if (this.inflight !== null) return this.inflight;
    if (this.lastStart !== null) {
      const wait = REFRESH_FLOOR_MS - (this.now() - this.lastStart);
      if (wait > 0) {
        const waitSeconds = Math.ceil(wait / 1000);
        throw new FlightdeckError(
          "invalid_state",
          `The account was read a moment ago: wait ${waitSeconds} s`,
          "account_refresh_too_soon",
          { waitSeconds },
        );
      }
    }
    return this.readNow();
  }

  /** Reads the account once now; a read already running is the one everybody gets. */
  readNow(): Promise<AccountState> {
    this.inflight ??= this.run().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async run(): Promise<AccountState> {
    this.lastStart = this.now();
    try {
      this.last = await this.read();
    } catch (error) {
      const reason = error instanceof FlightdeckError ? error.reason : undefined;
      this.last = {
        ...this.last,
        stale: this.last.readAt !== null,
        error: reason ?? "account_unavailable",
      };
    }
    this.arm();
    // Pushed before the read counts as finished, so the quota's own push stays quiet.
    const state = this.state();
    this.notify(state);
    return state;
  }

  /** The next poll, while somebody watches. */
  private arm(): void {
    this.disarm();
    if (this.watchers.size === 0) return;
    this.timer = this.timers.set(() => void this.readNow(), POLL_MS);
  }

  private disarm(): void {
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = null;
  }

  private notify(state = this.state()): void {
    for (const watcher of this.watchers) {
      try {
        watcher(state);
      } catch {
        // A broken watcher must not stop the others.
      }
    }
  }

  private async read(): Promise<AccountState> {
    const auth = await this.opts.readers.status();
    let status = auth === null ? null : statusOfAuth(auth);
    let info: AccountInfoReading | null = null;
    let usage: UsageReading | null = null;
    // Only a claude.ai account has a plan to ask about; the other hosts' SDK calls may even hang.
    if (status === null || status === "signed_in") {
      try {
        ({ info, usage } = await this.opts.readers.sdk());
      } catch (error) {
        // Without the status there is nothing else to show: the read fails. With it, only the
        // windows are lost (the usage report is an experimental API).
        if (status === null) throw error;
      }
    }
    status ??= statusOfInfo(info);
    if (usage !== null) this.opts.quota.record(usage.windows);
    return {
      status,
      name: auth?.email ?? info?.email ?? null,
      organization: auth?.organization ?? info?.organization ?? null,
      plan: auth?.plan ?? info?.plan ?? usage?.plan ?? null,
      provider: auth?.apiProvider ?? info?.apiProvider ?? null,
      windows: [],
      readAt: new Date(this.now()).toISOString(),
      stale: false,
      error: null,
      source: usage === null ? "status" : "sdk",
      loginCommand: LOGIN_COMMAND,
    };
  }
}
