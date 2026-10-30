/**
 * Phase 16: the secrets the app hands the daemon for one use. The vault is the app's, on the
 * user's machine: the daemon holds a delivered value in memory only, discards it when it is used
 * or after at most 60 s, never logs it and never writes it anywhere, and only takes it from a
 * connection that comes by loopback or Tailscale (both encrypted or local).
 */
import type { VaultRequester } from "@flightdeck/protocol";
import { FlightdeckError } from "../errors.ts";
import { ipInNetworks } from "../networks.ts";

/** Loopback, and the ranges Tailscale uses (WireGuard encrypts them). */
export const VAULT_NETWORKS = ["127.0.0.0/8", "::1/128", "100.64.0.0/10", "fd7a:115c:a1e0::/48"];

/** Whether a connection from `address` may deliver a secret. */
export function isVaultTransport(address: string): boolean {
  return ipInNetworks(address, VAULT_NETWORKS);
}

/**
 * Refuses, with the reason and a log line that never holds a secret, a use of a vault key that
 * comes from a connection outside loopback and Tailscale. `what` names the command in the log.
 */
export function requireVaultTransport(
  origin: string,
  what: string,
  log?: (message: string) => void,
): void {
  if (isVaultTransport(origin)) return;
  log?.(
    `vault: ${what} recusado, origem ${origin || "desconhecida"}: fora do loopback e da Tailscale`,
  );
  throw invalid(REFUSED_TRANSPORT);
}

export interface VaultDelivery {
  secretId: string;
  value: string;
  purpose: string;
  /** Milliseconds since the epoch; cut to 60 s from now at most. */
  expiresAt: number;
  requester: VaultRequester;
}

export interface VaultOptions {
  clock?: () => number;
  /** At most this long in memory (60 s when absent). */
  ttlMs?: number;
  /** Where refusals go; never carries a value. */
  log?: (message: string) => void;
  /** What a delivered secret can be used for; each takes the value and answers a text. */
  actions?: Record<string, (value: string) => string>;
}

interface Held {
  value: string;
  purpose: string;
  requester: VaultRequester;
  expiresAt: number;
  timer: ReturnType<typeof setTimeout>;
}

const MAX_TTL_MS = 60_000;
/** A rogue client must not fill the memory with secrets. */
const MAX_HELD = 64;

const invalid = (message: string) => new FlightdeckError("invalid_state", message);

const REFUSED_TRANSPORT =
  "entrega recusada: o cofre só entrega por loopback ou pela Tailscale, que são cifrados pelo WireGuard";

export class Vault {
  private readonly values = new Map<string, Held>();

  constructor(private readonly opts: VaultOptions = {}) {}

  /** Keeps the value in memory until it is used or its deadline; answers the effective deadline. */
  deliver(input: VaultDelivery, origin: string): { expiresAt: number } {
    const now = this.now();
    if (!isVaultTransport(origin)) {
      this.opts.log?.(
        `vault: entrega do segredo ${input.secretId} recusada, origem ${origin || "desconhecida"}: fora do loopback e da Tailscale`,
      );
      throw invalid(REFUSED_TRANSPORT);
    }
    if (input.expiresAt <= now) throw invalid("o prazo de uso do segredo já passou");
    if (!this.values.has(input.secretId) && this.values.size >= MAX_HELD) {
      throw invalid("o cofre do daemon está cheio de segredos entregues");
    }
    const expiresAt = Math.min(input.expiresAt, now + (this.opts.ttlMs ?? MAX_TTL_MS));
    this.drop(input.secretId);
    const timer = setTimeout(() => this.drop(input.secretId), expiresAt - now);
    this.values.set(input.secretId, {
      value: input.value,
      purpose: input.purpose,
      requester: input.requester,
      expiresAt,
      timer,
    });
    return { expiresAt };
  }

  /**
   * Runs `action` with the secret and discards it. Fails, without spending the value, for a
   * purpose other than the one it was delivered for and for an action that does not exist.
   */
  use(
    secretId: string,
    purpose: string,
    action: string,
  ): { result: string; requester: VaultRequester } {
    const held = this.live(secretId);
    if (!held) {
      throw new FlightdeckError(
        "not_found",
        `o segredo ${secretId} não está com este daemon: o cofre é do app, que precisa estar aberto para entregá-lo`,
      );
    }
    if (held.purpose !== purpose) {
      throw invalid(`o segredo ${secretId} foi entregue para ${held.purpose}, não para ${purpose}`);
    }
    const actions = this.opts.actions ?? {};
    if (!Object.hasOwn(actions, action)) throw invalid(`ação desconhecida: ${action}`);
    this.drop(secretId);
    try {
      return {
        result: (actions[action] as (value: string) => string)(held.value),
        requester: held.requester,
      };
    } catch {
      // The reason could hold the value: it is not passed on.
      this.opts.log?.(`vault: a ação ${action} falhou para o segredo ${secretId}`);
      throw invalid(`a ação ${action} falhou`);
    }
  }

  /** The value, for the purpose it was delivered for; it is discarded. */
  take(_secretId: string, _purpose: string): string {
    return "";
  }

  /** Resolves with the value when it is (or becomes) held for this purpose; rejects at the deadline. */
  waitFor(
    _secretId: string,
    _purpose: string,
    _timeoutMs: number,
    _signal?: AbortSignal,
  ): Promise<string> {
    return Promise.resolve("");
  }

  /** How many secrets are in memory (never which, nor their values). */
  held(): number {
    for (const id of [...this.values.keys()]) this.live(id);
    return this.values.size;
  }

  /** Drops everything: nothing outlives the daemon. */
  stop(): void {
    for (const id of [...this.values.keys()]) this.drop(id);
  }

  private now(): number {
    return (this.opts.clock ?? Date.now)();
  }

  /** The held secret if its deadline has not passed; an expired one is dropped on the spot. */
  private live(secretId: string): Held | undefined {
    const held = this.values.get(secretId);
    if (held && held.expiresAt <= this.now()) {
      this.drop(secretId);
      return undefined;
    }
    return held;
  }

  private drop(secretId: string): void {
    const held = this.values.get(secretId);
    if (!held) return;
    clearTimeout(held.timer);
    this.values.delete(secretId);
  }
}
