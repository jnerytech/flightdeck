/**
 * Guard against tests reaching the internet (phase 9: the daemon checks GitHub for updates).
 * Wraps `fetch`: local addresses go through, anything else is recorded and refused. The preload
 * fails the suite when anything was recorded.
 */
import { networkInterfaces } from "node:os";

/** Loopback and the machine's own interfaces: tests reaching the daemon off loopback stay here. */
const LOCAL = new Set([
  "127.0.0.1",
  "localhost",
  "[::1]",
  ...Object.values(networkInterfaces())
    .flat()
    .map((i) => (i?.family === "IPv6" ? `[${i.address}]` : (i?.address ?? ""))),
]);
const ACTIVE = Symbol.for("flightdeck.networkGuard");

export interface NetworkGuard {
  /** URLs a test tried to fetch outside the machine. */
  attempts: string[];
}

export function installNetworkGuard(
  target: { fetch: typeof globalThis.fetch } = globalThis,
): NetworkGuard {
  const original = target.fetch;
  const attempts: string[] = [];
  const guarded = (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (LOCAL.has(url.hostname)) return original(input, init);
    attempts.push(url.href);
    return Promise.reject(new Error(`trava de rede: acesso a ${url.host} recusado nos testes`));
  };
  target.fetch = Object.assign(guarded, original) as typeof globalThis.fetch;
  const guard = { attempts };
  (target as Record<symbol, unknown>)[ACTIVE] = guard;
  return guard;
}

/** The guard installed on `target` (the preload's, for `globalThis`). */
export function activeNetworkGuard(target: object = globalThis): NetworkGuard | undefined {
  return (target as Record<symbol, NetworkGuard | undefined>)[ACTIVE];
}

export function assertNoNetwork(guard: NetworkGuard): void {
  if (guard.attempts.length > 0) {
    throw new Error(`acesso à rede nos testes: ${guard.attempts.join(", ")}`);
  }
}
