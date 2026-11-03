import type { AccountState, AccountStatus } from "@flightdeck/protocol";
import { FlightdeckError } from "../errors.ts";
import type { Quota } from "../quota/quota.ts";
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
}

const LOGIN_COMMAND = "claude auth login";

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
  private last: AccountState = EMPTY;

  constructor(private readonly opts: AccountOptions) {
    this.now = opts.now ?? Date.now;
  }

  /** The last reading, with the windows still valid now. */
  state(): AccountState {
    const shows = this.last.status === "signed_in" || this.last.status === "unknown";
    return { ...this.last, windows: shows ? this.opts.quota.windows() : [] };
  }

  /** Reads the account once now. A failed read keeps the previous one and marks it stale. */
  async readNow(): Promise<AccountState> {
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
    return this.state();
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
