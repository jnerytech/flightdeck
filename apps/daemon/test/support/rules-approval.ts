import type { VaultAlertFrame, VaultRequestFrame, VaultUsed } from "@flightdeck/protocol";
import { Actions, type ActionsFrame, type ActionsOptions } from "../../src/actions/actions.ts";
import type { FlightdeckError } from "../../src/kernel/errors.ts";
import { EventStore } from "../../src/store/event-store.ts";
import { VaultRules } from "../../src/vault/rules-store.ts";
import { Vault } from "../../src/vault/vault.ts";
import { gitRepo } from "../support/board-helpers.ts";
import { poll, tempDir } from "../support/helpers.ts";

export const VALUE = "tok_SEGREDO-DE-TESTE-7d2f9a";
/** Wednesday 2026-10-28, 12:00 in São Paulo (UTC-3, no daylight time). */
export const NOW = Date.UTC(2026, 9, 28, 15, 0, 0);
export const HOUR = 3_600_000;

const cleanups: Array<() => unknown> = [];

export async function runCleanups() {
  for (const fn of cleanups.splice(0).reverse()) await fn();
}

export const echoDef = (over: Record<string, unknown> = {}) => ({
  name: "echo",
  description: "imprime o token",
  run: [process.execPath, "-e", "console.log(process.env.TOKEN)"],
  env: { TOKEN: "{{secret.token}}" },
  ...over,
});

export const failure = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return "ok";
  } catch (error) {
    const why = (error as FlightdeckError).reason;
    return `${(error as FlightdeckError).code}: ${(error as Error).message}${why ? ` [${why}]` : ""}`;
  }
};

export function setup(over: Partial<ActionsOptions> = {}, watching = true) {
  const { repo } = gitRepo();
  const store = new EventStore(":memory:");
  const vault = new Vault({ log: () => {} });
  const rules = new VaultRules();
  const now = { at: NOW };
  const actions = new Actions({
    db: store.db,
    vault,
    rules,
    hostName: "vps",
    hostBase: tempDir("fd-host-"),
    timeZone: "America/Sao_Paulo",
    clock: () => now.at,
    requestTimeoutMs: 3000,
    projects: () => ({ id: "p1", path: repo, baseBranch: "main" }),
    ...over,
  });
  const frames: ActionsFrame[] = [];
  const unwatch = watching ? actions.watch((frame) => frames.push(frame)) : () => {};
  cleanups.push(() => {
    unwatch();
    actions.stop();
    vault.stop();
  });
  const requests = () => frames.filter((f): f is VaultRequestFrame => f.type === "vault.request");
  const alerts = () => frames.filter((f): f is VaultAlertFrame => f.type === "vault.alert");
  const used = () => frames.filter((f): f is VaultUsed => f.type === "vault.used");
  const deliver = (frame: { secretId: string; purpose: string }) =>
    vault.deliver(
      {
        secretId: frame.secretId,
        value: VALUE,
        purpose: frame.purpose,
        expiresAt: Date.now() + 30_000,
        requester: "claude",
      },
      "127.0.0.1",
    );
  const run = (input: Record<string, unknown> = {}) =>
    actions.run({
      projectId: "p1",
      name: "echo",
      requestedBy: "claude",
      session: "s1",
      ...input,
    } as Parameters<Actions["run"]>[0]);
  /** The nth request frame, once it arrives. */
  const frame = async (n = 0) => (await poll(() => requests()[n])) as VaultRequestFrame;
  /** What the app does for an approval: approve, then deliver the secret. */
  const approveAndDeliver = (
    f: VaultRequestFrame,
    approval: Parameters<Actions["approve"]>[1] = { via: "app", heldMs: 0 },
  ) => {
    actions.approve(f.requestId, approval);
    actions.gate(f.purpose);
    deliver(f);
  };
  const setRules = (list: unknown[], tags: string[] = []) => rules.set("token", tags, list);
  return {
    actions,
    vault,
    rules,
    store,
    now,
    frames,
    requests,
    alerts,
    used,
    deliver,
    run,
    frame,
    approveAndDeliver,
    setRules,
  };
}

export const allow = (over: Record<string, unknown> = {}) => ({
  id: "liberar",
  match: { requester: "claude" },
  decision: "allow",
  ...over,
});
