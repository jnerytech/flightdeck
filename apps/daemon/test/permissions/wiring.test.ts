import { afterEach, describe, expect, test } from "bun:test";
import type { AutoApproveRequest } from "../../src/permissions/auto-approve.ts";
import { createPermissions, type PermissionsDeps } from "../../src/permissions/wiring.ts";
import type { JudgeOptions } from "../../src/runtime/types.ts";
import { EventStore } from "../../src/store/event-store.ts";

/**
 * The permission domain as main.ts builds it (issue #1593): the board's project and card for a
 * cwd reach the automatic approval, and the config's rules reach the risk classifier.
 */

const stores: EventStore[] = [];
afterEach(() => {
  for (const s of stores.splice(0)) s.close();
});

const project = {
  id: "p1",
  autoApprove: { enabled: true, model: "claude-haiku-5-5", lowWithoutAi: true },
};

function setup(found: ReturnType<PermissionsDeps["projectForCwd"]>) {
  const store = new EventStore(":memory:");
  stores.push(store);
  const prompts: string[] = [];
  const built = createPermissions({
    db: store.db,
    runtime: {
      judgePermission: async (opts: JudgeOptions) => {
        prompts.push(opts.prompt);
        return { decision: "ask", reason: "not sure" };
      },
    },
    config: { allowedRoots: ["/w"], dataDir: "/data", risk: { extraHigh: ["deploy-prod"] } },
    home: "/w/home",
    projectForCwd: (cwd) => (cwd.startsWith("/w/") ? found : null),
    usage: { record: () => undefined },
  });
  return { ...built, prompts };
}

const request = (level: "low" | "medium", cwd = "/w/c1"): AutoApproveRequest => ({
  sessionKey: "s1",
  requestId: "r1",
  toolName: "Bash",
  input: { command: "ls" },
  cwd,
  risk: { level, reason: "why", network: false },
});

describe("permissions-wiring: the approval the daemon builds (#1593)", () => {
  test("a cwd outside every project has no automatic approval", async () => {
    const { autoApprove } = setup({ project, card: null });
    expect(await autoApprove.decide(request("low", "/elsewhere"))).toBeNull();
  });

  test("the project's settings decide, and the decision is recorded under the project", async () => {
    const { autoApprove } = setup({ project, card: null });
    const decision = await autoApprove.decide(request("low"));
    expect([decision?.decision, decision?.by]).toEqual(["allow", "rule"]);
    expect(autoApprove.list({ projectId: "p1" }).map((r) => r.requestId)).toEqual(["r1"]);
  });

  test("a card's description reaches the AI, and a suspended card holds its sessions", async () => {
    const { autoApprove, prompts } = setup({
      project,
      card: { id: "c1", description: "rename the parser" },
    });
    await autoApprove.decide(request("medium"));
    expect(prompts.map((p) => p.includes("pedido do card: rename the parser"))).toEqual([true]);
    autoApprove.suspendCard("c1", "web content");
    const held = await autoApprove.decide(request("low"));
    expect([held?.decision, held?.reason.includes("web content")]).toEqual(["ask", true]);
  });

  test("the config's extra rules and the home reach the risk classifier", () => {
    const { risk } = setup(null);
    expect(risk.classify("Bash", { command: "deploy-prod now" }, "/w/c1").level).toBe("high");
    // `~` is the home given, inside the allowed root: a write there is not outside the roots.
    expect(risk.classify("Write", { file_path: "~/notes.md" }, "/other").level).toBe("medium");
  });
});
