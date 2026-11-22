import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RunConfigs } from "../../src/runenv/config.ts";
import { RunManager } from "../../src/runenv/manager.ts";
import { CardPorts } from "../../src/runenv/ports.ts";
import { startServer } from "../../src/server.ts";
import { git, newBoard } from "../support/board-helpers.ts";
import { FrameClient } from "../support/history-helpers.ts";
import { fakeRunHost } from "./helpers.ts";

setDefaultTimeout(30_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const TOKEN = "runenv-near-token-0123456789abc";
const YAML = `run:
  - name: web
    cmd: ["serve", "--port", "{{port.web}}"]
ports: [web]
`;
const sha256 = (text: string) => new Bun.CryptoHasher("sha256").update(text).digest("hex");

/**
 * Issue #3807: trusting a run.yaml lets its commands run on the host when a card starts, so only
 * a near connection (this computer or Tailscale) may do it, as it may trust a workflow.
 */
describe("runenv.trust is near only (#3807)", () => {
  test("a far connection is refused with transport_refused and the run.yaml stays untrusted; a near one trusts it", async () => {
    const ctx = newBoard();
    mkdirSync(join(ctx.repo, ".flightdeck"), { recursive: true });
    writeFileSync(join(ctx.repo, ".flightdeck", "run.yaml"), YAML);
    git(ctx.repo, "add", ".flightdeck");
    git(ctx.repo, "commit", "-q", "-m", "run.yaml");
    const project = await ctx.board.addProject({ path: ctx.repo });
    const configs = new RunConfigs({ db: ctx.store.db });
    const manager = new RunManager({
      db: ctx.store.db,
      configs,
      ports: new CardPorts({ db: ctx.store.db, isFree: async () => true }),
      host: fakeRunHost().host,
      card: (id) => ({ id, projectId: project.id, worktreePath: `/work/${id}` }),
      project: (id) => ctx.board.getProject(id),
      waitReady: async () => "ready",
    });
    cleanups.push(() => ctx.board.stop());
    const base = {
      manager: ctx.manager,
      board: ctx.board,
      runenv: { configs, manager },
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [ctx.root],
      allowedNetworks: ["0.0.0.0/0", "::/0"],
    };
    const servers = [startServer(base), startServer({ ...base, peerOf: () => "8.8.8.8" })];
    const clients = servers.map((server) => new FrameClient(server.url));
    cleanups.push(async () => {
      for (const client of clients) client.close();
      for (const server of servers) await server.stop();
    });
    for (const client of clients) await client.request("hello", { token: TOKEN, client: "t" });
    const [near, far] = clients as [FrameClient, FrameClient];
    const payload = { projectId: project.id, hash: sha256(YAML) };
    const trustedNow = async () => (await configs.info(ctx.board.getProject(project.id))).trusted;
    const refused = await far.request("runenv.trust", payload);
    const afterFar = await trustedNow();
    const accepted = await near.request("runenv.trust", payload);
    const afterNear = await trustedNow();
    expect([
      (refused.error as { reason?: string } | undefined)?.reason ?? null,
      afterFar,
      accepted.ok,
      afterNear,
    ]).toEqual(["transport_refused", false, true, true]);
  });
});
