import { FlightdeckError } from "../errors.ts";
import type { Exec } from "../exec.ts";
import type { QuotaReading } from "../runtime/types.ts";

/** What `claude auth status --json` says; a missing key is `null`. */
export interface AuthStatus {
  loggedIn: boolean | null;
  authMethod: string | null;
  apiProvider: string | null;
  email: string | null;
  organization: string | null;
  plan: string | null;
}

/** What the SDK's `accountInfo()` says; a missing key is `null`. */
export interface AccountInfoReading {
  email: string | null;
  organization: string | null;
  plan: string | null;
  tokenSource: string | null;
  apiKeySource: string | null;
  apiProvider: string | null;
}

/** The plan windows of the usage report, as the quota takes them (utilization 0 to 1). */
export interface UsageReading {
  plan: string | null;
  available: boolean;
  windows: QuotaReading[];
}

/** The part of an SDK `Query` the readers use. */
export interface IdleQuery {
  accountInfo?(): Promise<unknown>;
  usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET?(opts?: {
    skipBehaviors?: boolean;
  }): Promise<unknown>;
  close?(): void;
}

export interface IdleQueryDeps {
  query: (params: { prompt: AsyncIterable<never>; options: Record<string, unknown> }) => IdleQuery;
  claudePath: string | null;
}

export const READ_TIMEOUT_MS = 20_000;

/** A read that failed or hung: the app shows a retry and the last good reading. */
function unavailable(why: string): FlightdeckError {
  return new FlightdeckError(
    "invalid_state",
    `The account could not be read: ${why}`,
    "account_unavailable",
  );
}

/** Waits for `work`, but no longer than `ms`; any failure or the timeout is `account_unavailable`. */
async function bounded<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer in ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } catch (error) {
    throw unavailable(error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timer);
  }
}

const text = (value: unknown): string | null =>
  typeof value === "string" && value !== "" ? value : null;

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/** "Claude Max", "max" and " MAX " are one plan: `max`. */
export function normalizePlan(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const plan = raw
    .trim()
    .toLowerCase()
    .replace(/^claude\s+/, "");
  return plan === "" ? null : plan;
}

export async function authStatus(deps: {
  claudePath: string | null;
  exec: Exec;
  timeoutMs?: number;
}): Promise<AuthStatus | null> {
  // No path (the SDK uses its bundled CLI): nothing to run.
  if (deps.claudePath === null) return null;
  // Signed out, the command prints its JSON and exits 1, so the exit code is not read.
  const { stdout } = await bounded(
    deps.exec([deps.claudePath, "auth", "status", "--json"]),
    deps.timeoutMs ?? READ_TIMEOUT_MS,
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }
  const raw = record(parsed);
  if (raw === null) return null;
  return {
    loggedIn: typeof raw.loggedIn === "boolean" ? raw.loggedIn : null,
    authMethod: text(raw.authMethod),
    apiProvider: text(raw.apiProvider),
    email: text(raw.email),
    organization: text(raw.orgName),
    plan: normalizePlan(raw.subscriptionType),
  };
}

export async function accountInfo(
  query: IdleQuery,
  timeoutMs = READ_TIMEOUT_MS,
): Promise<AccountInfoReading | null> {
  if (!query.accountInfo) return null;
  const raw = record(await bounded(query.accountInfo(), timeoutMs));
  if (raw === null) return null;
  return {
    email: text(raw.email),
    organization: text(raw.organization),
    plan: normalizePlan(raw.subscriptionType),
    tokenSource: text(raw.tokenSource),
    apiKeySource: text(raw.apiKeySource),
    apiProvider: text(raw.apiProvider),
  };
}

/** The windows Flightdeck shows; the report's other keys have opaque server-side names. */
const WINDOWS = ["five_hour", "seven_day", "seven_day_opus", "seven_day_sonnet"] as const;

/** From the share of the window used: the CLI warns from 80 % and refuses at 100 %. */
function statusOf(utilization: number): QuotaReading["status"] {
  if (utilization >= 1) return "rejected";
  return utilization >= 0.8 ? "allowed_warning" : "allowed";
}

export async function usageReport(
  query: IdleQuery,
  timeoutMs = READ_TIMEOUT_MS,
): Promise<UsageReading> {
  const none: UsageReading = { plan: null, available: false, windows: [] };
  const call = query.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET;
  if (!call) return none;
  const raw = record(await bounded(call.call(query, { skipBehaviors: true }), timeoutMs));
  const limits = record(raw?.rate_limits);
  if (raw === null || raw.rate_limits_available !== true || limits === null) {
    return { ...none, plan: normalizePlan(raw?.subscription_type) };
  }
  const windows = WINDOWS.flatMap((window): QuotaReading[] => {
    const entry = record(limits[window]);
    if (typeof entry?.utilization !== "number") return [];
    const utilization = entry.utilization / 100;
    const resetsAt = typeof entry.resets_at === "string" ? Date.parse(entry.resets_at) : Number.NaN;
    return [
      {
        window,
        utilization,
        status: statusOf(utilization),
        resetsAt: Number.isNaN(resetsAt) ? null : resetsAt,
      },
    ];
  });
  return { plan: normalizePlan(raw.subscription_type), available: true, windows };
}

/** A query that never receives a prompt, which is enough to ask the CLI about the account. */
export async function withIdleQuery<T>(
  deps: IdleQueryDeps,
  fn: (query: IdleQuery) => Promise<T>,
): Promise<T> {
  const idle: AsyncIterable<never> = {
    [Symbol.asyncIterator]: () => ({ next: () => new Promise<never>(() => {}) }),
  };
  const query = deps.query({
    prompt: idle,
    options: {
      settingSources: [],
      persistSession: false,
      ...(deps.claudePath ? { pathToClaudeCodeExecutable: deps.claudePath } : {}),
    },
  });
  try {
    return await fn(query);
  } finally {
    query.close?.();
  }
}
