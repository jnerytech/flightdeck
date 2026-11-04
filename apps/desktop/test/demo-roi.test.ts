import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { RoiSummaryResult } from "@flightdeck/protocol";
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
  await alfa.request("hello", { token: host?.token, client: "demo-roi-test" });
});
afterAll(async () => {
  alfa.close();
  await seed.stop();
});

describe("demo-roi: what the return-on-cost journeys need from the demo", () => {
  test("this month so far has four cards done, two planned and two unplanned, two as merged PRs, and the period before has two", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const result = await alfa.data<RoiSummaryResult>("roi.summary", {
      from: `${today.slice(0, 7)}-01`,
      to: today,
    });
    const web = result?.projects.find((p) => p.name === "flightdeck-web");
    expect(web?.current).toMatchObject({ cards: 4, planned: 2, unplanned: 2, prsMerged: 2 });
    expect(web?.previous.cards).toBe(2);
  });
});
