import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { type DemoSeed, seedDemo } from "../../../scripts/demo-seed.ts";
import { FrameClient } from "../../daemon/test/history-helpers.ts";

setDefaultTimeout(60_000);

let seed: DemoSeed;
let alfa: FrameClient;
beforeAll(async () => {
  const home = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  seed = await seedDemo();
  for (const [key, value] of Object.entries(home)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const host = seed.hosts[0];
  alfa = new FrameClient(host?.url ?? "");
  await alfa.request("hello", { token: host?.token, client: "demo-rastro-test" });
});
afterAll(async () => {
  alfa.close();
  await seed.stop();
});

interface Node {
  id: string;
  kind: string;
  costUsd: number | null;
  children: Node[];
}

describe("demo-rastro: what the Rastro tab needs from the demo", () => {
  test("the host announces trace", async () => {
    const info = await alfa.data<{ features: string[] }>("host.info", {});
    expect(info?.features).toContain("trace");
  });

  test("a finished terminal session has a trace of two turns with a subagent inside, priced", async () => {
    // The costs come from the usage indexer's first pass over the transcripts.
    for (let i = 0; i < 200; i++) {
      const status = await alfa.data<{ initialLoad: { state: string } }>("costs.status", {});
      if (status?.initialLoad.state === "done") break;
      await Bun.sleep(50);
    }
    const trace = await alfa.data<{ turns: Node[]; costUsd: number | null }>("trace.get", {
      claudeSessionId: seed.ids.traceSession,
    });
    expect(trace?.turns.map((t) => t.id)).toEqual(["turn:1", "turn:2"]);
    const kinds = (nodes: Node[]): string[] => nodes.flatMap((n) => [n.kind, ...kinds(n.children)]);
    expect(kinds(trace?.turns ?? [])).toContain("subagent");
    expect(trace?.costUsd ?? 0).toBeGreaterThan(0);
  });
});
