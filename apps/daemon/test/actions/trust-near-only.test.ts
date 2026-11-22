import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { startServer } from "../../src/server.ts";
import { commitActions, echoDef, runCleanups, setup } from "../support/actions-service.ts";
import { newManager } from "../support/helpers.ts";
import { FrameClient } from "../support/history-helpers.ts";

setDefaultTimeout(30_000);
afterEach(runCleanups);

const TOKEN = "actions-near-token-0123456789abc";

/**
 * Issue #3807: trusting an action, or saving one (the app's own are trusted as they are saved),
 * lets its command run on the host, so only a near connection (this computer or Tailscale) may do
 * it, as it may trust a workflow, add a template or confirm a resume.
 */
async function nearAndFar() {
  const ctx = setup();
  const { manager } = newManager();
  const base = {
    manager,
    actions: ctx.actions,
    hostName: "h",
    bind: "127.0.0.1",
    port: 0,
    token: TOKEN,
    allowedRoots: [],
    allowedNetworks: ["0.0.0.0/0", "::/0"],
  };
  const servers = [startServer(base), startServer({ ...base, peerOf: () => "8.8.8.8" })];
  const clients = servers.map((server) => new FrameClient(server.url));
  for (const client of clients) await client.request("hello", { token: TOKEN, client: "t" });
  const [near, far] = clients as [FrameClient, FrameClient];
  const close = async () => {
    for (const client of clients) client.close();
    for (const server of servers) await server.stop();
  };
  return { ...ctx, near, far, close };
}

const reasonOf = (frame: { error?: unknown }) =>
  (frame.error as { reason?: string } | undefined)?.reason ?? null;

describe("actions.trust is near only (#3807)", () => {
  test("a far connection is refused with transport_refused and the action stays untrusted; a near one trusts it", async () => {
    const { actions, repo, near, far, close } = await nearAndFar();
    try {
      commitActions(repo, [echoDef()]);
      const first = (await actions.list("p1")).actions[0] as { hash: string };
      const payload = { projectId: "p1", name: "echo", hash: first.hash };
      const trustedNow = async () =>
        ((await actions.list("p1")).actions[0] as { trusted: boolean }).trusted;
      const refused = await far.request("actions.trust", payload);
      const afterFar = await trustedNow();
      const accepted = await near.request("actions.trust", payload);
      const afterNear = await trustedNow();
      expect([reasonOf(refused), afterFar, accepted.ok, afterNear]).toEqual([
        "transport_refused",
        false,
        true,
        true,
      ]);
    } finally {
      await close();
    }
  });
});

describe("actions.save is near only (#3807)", () => {
  test("a far connection is refused with transport_refused and nothing is saved; a near one saves it, trusted", async () => {
    const { actions, near, far, close } = await nearAndFar();
    try {
      const payload = { projectId: "p1", definition: echoDef() };
      const names = async () => (await actions.list("p1")).actions.map((a) => a.name);
      const refused = await far.request("actions.save", payload);
      const afterFar = await names();
      const accepted = await near.request("actions.save", payload);
      const afterNear = await names();
      const saved = (await actions.list("p1")).actions[0] as { trusted: boolean };
      expect([reasonOf(refused), afterFar, accepted.ok, afterNear, saved.trusted]).toEqual([
        "transport_refused",
        [],
        true,
        ["echo"],
        true,
      ]);
    } finally {
      await close();
    }
  });
});
