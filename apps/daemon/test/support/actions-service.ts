import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { VaultRequestFrame, VaultUsed } from "@flightdeck/protocol";
import { Actions, type ActionsFrame, type ActionsOptions } from "../../src/actions/actions.ts";
import { FlightdeckError } from "../../src/kernel/errors.ts";
import { EventStore } from "../../src/store/event-store.ts";
import { Vault } from "../../src/vault/vault.ts";
import { git, gitRepo } from "../support/board-helpers.ts";
import { tempDir } from "../support/helpers.ts";

export const VALUE = "tok_SEGREDO-DE-TESTE-7d2f9a";
export const BASE64 = Buffer.from(VALUE).toString("base64");
export const HEX = Buffer.from(VALUE).toString("hex");

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

export function setup(over: Partial<ActionsOptions> = {}) {
  const { repo } = gitRepo();
  const store = new EventStore(":memory:");
  const vault = new Vault({ log: () => {} });
  const hostBase = tempDir("fd-host-");
  const project = { id: "p1", path: repo, baseBranch: "main" };
  const actions = new Actions({
    db: store.db,
    vault,
    hostBase,
    requestTimeoutMs: 3000,
    projects: (id) => {
      if (id !== "p1") throw new FlightdeckError("not_found", `projeto ${id} não existe`);
      return project;
    },
    ...over,
  });
  const frames: ActionsFrame[] = [];
  const unwatch = actions.watch((frame) => frames.push(frame));
  cleanups.push(() => {
    unwatch();
    actions.stop();
    vault.stop();
  });
  const requests = () => frames.filter((f): f is VaultRequestFrame => f.type === "vault.request");
  const used = () => frames.filter((f): f is VaultUsed => f.type === "vault.used");
  /** What the app does on approving: delivers the value for the purpose the request carries. */
  const deliver = (frame: { secretId: string; purpose: string }, value = VALUE) =>
    vault.deliver(
      {
        secretId: frame.secretId,
        value,
        purpose: frame.purpose,
        expiresAt: Date.now() + 30_000,
        requester: "claude",
      },
      "127.0.0.1",
    );
  /** The app, approving every request as it comes. */
  const approveAll = () =>
    actions.watch((frame) => {
      if (frame.type === "vault.request") deliver(frame);
    });
  /** The app, as the user starting an action: delivers first, for the `you` purpose. */
  const deliverForYou = (name: string, secretId = "token", value = VALUE) =>
    vault.deliver(
      {
        secretId,
        value,
        purpose: `action:${name}:you`,
        expiresAt: Date.now() + 30_000,
        requester: "you",
      },
      "127.0.0.1",
    );
  return {
    actions,
    vault,
    store,
    repo,
    hostBase,
    project,
    frames,
    requests,
    used,
    deliver,
    approveAll,
    deliverForYou,
  };
}

/** Commits `.flightdeck/actions.yaml` (JSON is YAML) on main. */
export function commitActions(repo: string, list: unknown, message = "ações") {
  mkdirSync(join(repo, ".flightdeck"), { recursive: true });
  writeFileSync(join(repo, ".flightdeck", "actions.yaml"), JSON.stringify(list));
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", message);
}
