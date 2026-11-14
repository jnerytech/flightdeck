/**
 * The account readings (#1601): what the CLI's `auth status`, the SDK's `accountInfo()` and its usage
 * report mean once read. No I/O: the raw answers come in as arguments.
 */
import type { QuotaReading } from "../../runtime/index.ts";

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
  /** The plan's display name from the server ("Claude Ultra"), normalized: `ultra`. */
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

/** The status in `claude auth status --json`'s parsed output, or null when it is no object. */
export function authStatusOf(parsed: unknown): AuthStatus | null {
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

/** The reading in the SDK's `accountInfo()` answer, or null when it is no object. */
export function accountInfoOf(answer: unknown): AccountInfoReading | null {
  const raw = record(answer);
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

/** The plan windows in the SDK's usage report answer. */
export function usageOf(answer: unknown): UsageReading {
  const none: UsageReading = { plan: null, available: false, windows: [] };
  const raw = record(answer);
  const limits = record(raw?.rate_limits);
  if (raw?.rate_limits_available !== true || limits === null) {
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
