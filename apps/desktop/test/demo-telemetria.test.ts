import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { type DemoSeed, seedDemo } from "../../../scripts/demo-seed.ts";
import { FrameClient } from "../../daemon/test/history-helpers.ts";

setDefaultTimeout(60_000);

let seed: DemoSeed;
let alfa: FrameClient;
beforeAll(async () => {
  // The seed points HOME at its own temporary folder; the suite's home guard needs its own back.
  const home = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  seed = await seedDemo();
  for (const [key, value] of Object.entries(home)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const host = seed.hosts[0];
  alfa = new FrameClient(host?.url ?? "");
  await alfa.request("hello", { token: host?.token, client: "demo-telemetria-test" });
});
afterAll(async () => {
  alfa.close();
  await seed.stop();
});

interface Prompt {
  items: Array<{
    kind: string;
    waitMs: number | null;
    error: string | null;
    toolName: string | null;
  }>;
  waitMs: number;
}

describe("demo-telemetria: what the Tempo tab and the Custos time panel need from the demo", () => {
  test("the host announces telemetry", async () => {
    const info = await alfa.data<{ features: string[] }>("host.info", {});
    expect(info?.features).toContain("telemetry");
  });

  test("a session of the demo has a timeline of two prompts with a permission wait, a slow tool and an API error", async () => {
    const timeline = await alfa.data<{ prompts: Prompt[] }>("telemetry.session", {
      claudeSessionId: seed.ids.telemetrySession,
    });
    expect(timeline?.prompts.length).toBe(2);
    const items = timeline?.prompts.flatMap((p) => p.items) ?? [];
    expect(items.some((i) => i.kind === "permission" && (i.waitMs ?? 0) > 0)).toBe(true);
    expect(items.some((i) => i.kind === "tool" && i.toolName === "Bash")).toBe(true);
    expect(items.some((i) => i.kind === "error" && i.error === "529")).toBe(true);
  });

  test("it is the claude session of a session the hub lists, so the tab opens on it", async () => {
    const list = await alfa.data<{ sessions: Array<{ id: string; claudeSessionId?: string }> }>(
      "session.list",
      {},
    );
    expect(list?.sessions.find((s) => s.id === seed.ids.idleSession)?.claudeSessionId).toBe(
      seed.ids.telemetrySession,
    );
  });

  test("Custos has a project with wait time and slowest tools", async () => {
    const summary = await alfa.data<{
      projects: Array<{ projectKey: string; waitMs: number; slowest: unknown[] }>;
    }>("telemetry.summary", {});
    expect(summary?.projects.length).toBeGreaterThanOrEqual(1);
    expect(summary?.projects.some((p) => p.waitMs > 0 && p.slowest.length > 0)).toBe(true);
  });
});
