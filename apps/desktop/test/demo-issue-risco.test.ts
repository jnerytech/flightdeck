import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { DANGER_SESSION, type DemoSeed, seedDemo } from "../../../scripts/demo-seed.ts";
import { FrameClient } from "../../daemon/test/history-helpers.ts";

// Two daemons, real git and a fake `gh`: more than the default 5 s.
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
  await alfa.request("hello", { token: host?.token, client: "demo-issue-risco-test" });
});
afterAll(async () => {
  alfa.close();
  await seed.stop();
});

describe("demo-issue-risco: what the issue-and-risk journey needs from the demo", () => {
  test("the web project has a GitHub issue to turn into a card, from a fake gh", async () => {
    const result = await alfa.data<{ issues: Array<{ ref: string; title: string }> }>(
      "issues.list",
      { projectId: seed.ids.project },
    );
    expect(result?.issues.map((i) => [i.ref, i.title])).toEqual([
      ["github:Acme/App#7", "Corrigir o login com SSO"],
    ]);
  });

  test("a terminal session waits for a Bash rm -rf, which is high risk", async () => {
    const result = await alfa.data<{
      sessions: Array<{ status: string; meta?: { name?: string | null } }>;
    }>("external.list", {});
    const danger = result?.sessions.find((s) => s.meta?.name === DANGER_SESSION);
    expect(danger?.status).toBe("awaiting_permission");
  });

  test("the web project versions an action that is not trusted yet, for the actions journey", async () => {
    const result = await alfa.data<{
      actions: Array<{ name: string; source: string; trusted: boolean }>;
    }>("actions.list", { projectId: seed.ids.project });
    expect(result?.actions.map((a) => [a.name, a.source, a.trusted])).toEqual([
      ["versao", "versioned", false],
    ]);
  });
});
