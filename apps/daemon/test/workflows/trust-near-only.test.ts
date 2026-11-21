import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { startServer } from "../../src/server.ts";
import { newBoard } from "../support/board-helpers.ts";
import { FrameClient } from "../support/history-helpers.ts";
import { commitWorkflow, sha256 } from "../support/workflow-helpers.ts";

setDefaultTimeout(30_000);

/**
 * Issue #3799: trusting a workflow lets its `check` commands run on the host, so only a near
 * connection (this computer or Tailscale) may do it, as it may add a template or confirm a resume.
 */
const YAML = ["steps:", "  - id: a", "    check: fd-check a"].join("\n");

describe("workflow.trust is near only (#3799)", () => {
  test("a far connection is refused with transport_refused and the workflow stays untrusted; a near one trusts it", async () => {
    const { board, manager, repo, root } = newBoard();
    commitWorkflow(repo, "wf", YAML);
    const project = await board.addProject({ path: repo, promptTemplate: "" });
    const token = "workflow-trust-token-0123456789abc";
    const base = {
      manager,
      board,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token,
      allowedRoots: [root],
      allowedNetworks: ["0.0.0.0/0", "::/0"],
    };
    const servers = [startServer(base), startServer({ ...base, peerOf: () => "8.8.8.8" })];
    const clients = servers.map((server) => new FrameClient(server.url));
    try {
      for (const client of clients) await client.request("hello", { token, client: "t" });
      const [near, far] = clients as [FrameClient, FrameClient];
      const payload = { projectId: project.id, name: "wf", hash: sha256(YAML) };
      const trustedNow = async () =>
        (await board.listWorkflows(project.id)).find((w) => w.name === "wf")?.trusted;
      const refused = await far.request("workflow.trust", payload);
      const error = refused.error as { code?: string; reason?: string } | undefined;
      const afterFar = await trustedNow();
      const accepted = await near.request("workflow.trust", payload);
      const afterNear = await trustedNow();
      expect([error?.code ?? error?.reason ?? null, afterFar, accepted.ok, afterNear]).toEqual([
        "transport_refused",
        false,
        true,
        true,
      ]);
    } finally {
      for (const client of clients) client.close();
      for (const server of servers) await server.stop();
    }
  });
});
