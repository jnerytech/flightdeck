import { z } from "zod";
import { type Exec, FlightdeckError, parseJsonOr } from "../kernel/index.ts";
import {
  type AccountInfoReading,
  type AuthStatus,
  accountInfoOf,
  authStatusOf,
  type UsageReading,
  usageOf,
} from "./domain/readings.ts";

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
  const parsed = parseJsonOr(z.unknown(), stdout, null);
  return authStatusOf(parsed);
}

export async function accountInfo(
  query: IdleQuery,
  timeoutMs = READ_TIMEOUT_MS,
): Promise<AccountInfoReading | null> {
  if (!query.accountInfo) return null;
  return accountInfoOf(await bounded(query.accountInfo(), timeoutMs));
}

export async function usageReport(
  query: IdleQuery,
  timeoutMs = READ_TIMEOUT_MS,
): Promise<UsageReading> {
  const call = query.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET;
  // No usage call: the empty reading.
  if (!call) return usageOf(null);
  return usageOf(await bounded(call.call(query, { skipBehaviors: true }), timeoutMs));
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
      // settingSources does not cover .mcp.json, and this runs in the folder it was started in.
      strictMcpConfig: true,
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

/** What the service asks; the daemon wires the real ones, tests wire fakes. */
export interface AccountReaders {
  status(): Promise<AuthStatus | null>;
  sdk(): Promise<{ info: AccountInfoReading | null; usage: UsageReading }>;
}

/** The readers a daemon with the real runtime hands to the `Account`. */
export function accountReaders(deps: IdleQueryDeps & { exec: Exec }): AccountReaders {
  return {
    status: () => authStatus({ claudePath: deps.claudePath, exec: deps.exec }),
    sdk: () =>
      withIdleQuery(deps, async (query) => ({
        info: await accountInfo(query),
        usage: await usageReport(query),
      })),
  };
}
