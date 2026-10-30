import { afterEach, describe, expect, test } from "bun:test";
import type { VaultRequestFrame } from "@flightdeck/protocol";
import { Actions, type ActionsFrame } from "../src/actions/actions.ts";
import type { SshJob } from "../src/actions/run.ts";
import { FlightdeckError } from "../src/errors.ts";
import { EventStore } from "../src/store/event-store.ts";
import { Vault } from "../src/vault/vault.ts";
import { gitRepo } from "./board-helpers.ts";
import { poll } from "./helpers.ts";

const TOKEN = "tok_ACTION-TOKEN-5c1e";
const KEY =
  "-----BEGIN OPENSSH PRIVATE KEY-----\nTEST-ONLY-SSH-ACTION-KEY-93ad\n-----END OPENSSH PRIVATE KEY-----";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** An actions service whose ssh executor echoes the token and the key it got, on two destinos. */
function setup() {
  const { repo } = gitRepo();
  const store = new EventStore(":memory:");
  const logs: string[] = [];
  const vault = new Vault({ log: (line: string) => logs.push(line) });
  const jobs: SshJob[] = [];
  const actions = new Actions({
    db: store.db,
    vault,
    requestTimeoutMs: 1500,
    projects: (id) => {
      if (id !== "p1") throw new FlightdeckError("not_found", "projeto");
      return { id: "p1", path: repo, baseBranch: "main" };
    },
    ssh: async (job) => {
      jobs.push(job);
      return {
        exitCode: 0,
        stdout: `${job.env.TOKEN} ${job.privateKey ?? "sem-chave"}\n`,
        stderr: "",
      };
    },
    sshKey: (target) => (target === "cofre" ? "deploy-key" : null),
  });
  const frames: ActionsFrame[] = [];
  const unwatch = actions.watch((frame) => frames.push(frame));
  cleanups.push(() => {
    unwatch();
    actions.stop();
    vault.stop();
  });
  const requests = () => frames.filter((f): f is VaultRequestFrame => f.type === "vault.request");
  /** The app answering a request, from `address`: the token or the key, for that purpose only. */
  const answer = (address: string, keyAddress = address) =>
    actions.watch((frame) => {
      if (frame.type !== "vault.request") return;
      try {
        vault.deliver(
          {
            secretId: frame.secretId,
            value: frame.secretId === "deploy-key" ? KEY : TOKEN,
            purpose: frame.purpose,
            expiresAt: Date.now() + 30_000,
            requester: "claude",
          },
          frame.secretId === "deploy-key" ? keyAddress : address,
        );
      } catch {
        // A delivery from a network the vault does not trust is refused; the run waits and fails.
      }
    });
  const save = (ssh: string) =>
    actions.save({
      projectId: "p1",
      definition: {
        name: `logs-${ssh}`,
        description: "logs",
        ssh,
        run: ["journalctl", "-n", "5"],
        env: { TOKEN: "{{secret.token}}" },
        approval: "never",
      },
    });
  return { actions, store, jobs, frames, requests, answer, save, logs };
}

describe("acoes-execucao: the key of an ssh action's destino comes from the vault", () => {
  test("a vault-key destino's key is asked of the app like the action's secrets, reaches the executor, and is masked wherever it would show", async () => {
    const { actions, store, jobs, frames, requests, answer, save, logs } = setup();
    await save("cofre");
    answer("127.0.0.1");
    const done = await actions.run({ projectId: "p1", name: "logs-cofre", requestedBy: "claude" });
    expect(
      requests()
        .map((r) => r.secretId)
        .sort(),
    ).toEqual(["deploy-key", "token"]);
    expect(requests().every((r) => r.action === "logs-cofre")).toBe(true);
    expect(jobs.map((j) => j.privateKey)).toEqual([KEY]);
    expect(done.output).toBe("•••(token) •••(deploy-key)\n");
    const stored = JSON.stringify(store.db.query("SELECT * FROM action_runs").all());
    for (const text of [JSON.stringify(frames), stored, JSON.stringify(done), logs.join("\n")]) {
      expect(text).not.toContain("TEST-ONLY-SSH-ACTION-KEY");
    }
  });

  test("a destino that does not use a vault key asks for no key", async () => {
    const { actions, jobs, requests, answer, save } = setup();
    await save("prod");
    answer("127.0.0.1");
    await actions.run({ projectId: "p1", name: "logs-prod", requestedBy: "claude" });
    expect(requests().map((r) => r.secretId)).toEqual(["token"]);
    expect(jobs.map((j) => j.privateKey)).toEqual([undefined]);
  });

  test("a key delivered from the LAN is refused, so the run never gets it and fails", async () => {
    const { actions, jobs, save, answer, requests } = setup();
    await save("cofre");
    // The token comes from this machine; only the key comes from another one on the network.
    answer("127.0.0.1", "192.168.1.20");
    let failed = "";
    await actions
      .run({ projectId: "p1", name: "logs-cofre", requestedBy: "claude" })
      .catch((error: Error) => {
        failed = error.message;
      });
    await poll(() => failed !== "");
    expect(failed).not.toBe("");
    expect(requests().map((r) => r.secretId)).toContain("deploy-key");
    expect(jobs).toEqual([]);
  });

  test("run_with_secret on another host runs the command with sh -c on that destino, its key from the vault too", async () => {
    const { actions, jobs, requests, answer } = setup();
    answer("127.0.0.1");
    const done = await actions.runFree({
      command: "make deploy",
      secrets: ["token"],
      host: "cofre",
      requestedBy: "claude",
    });
    expect(jobs.map((j) => [j.target, j.argv, j.env, j.privateKey])).toEqual([
      ["cofre", ["sh", "-c", "make deploy"], { TOKEN: TOKEN }, KEY],
    ]);
    const asked = requests();
    expect(asked.map((r) => r.secretId).sort()).toEqual(["deploy-key", "token"]);
    expect(asked.every((r) => r.host === "cofre" && r.command === "make deploy")).toBe(true);
    expect(done.output).toBe("•••(token) •••(deploy-key)\n");
  });
});
