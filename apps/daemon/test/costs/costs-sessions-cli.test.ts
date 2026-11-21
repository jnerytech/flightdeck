import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { runCostsCli } from "../../src/costs/index.ts";
import { config, fakeDaemon, stopAll } from "../board/card-cli-helpers.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

describe("costs sessions (issue #3755)", () => {
  test("asks for every id in one call and prints a line per id, 0 dollars for one the daemon lacks", async () => {
    const daemon = fakeDaemon({ "costs.sessions": () => ({ costs: { a1: 3.2, b2: 0.5 } }) });
    const result = await runCostsCli(
      { action: "sessions", ids: ["a1", "b2", "zz"] },
      config(daemon.port),
      { timeoutMs: 3_000 },
    );
    expect({ code: result.code, out: result.out, sent: daemon.calls[0]?.payload }).toEqual({
      code: 0,
      out: ["a1  $3.20", "b2  $0.50", "zz  $0.00"],
      sent: { claudeSessionIds: ["a1", "b2", "zz"] },
    });
  });

  test("--json prints the daemon's answer as it is", async () => {
    const answer = { costs: { a1: 3.2 } };
    const result = await runCostsCli(
      { action: "sessions", ids: ["a1"], json: true },
      config(fakeDaemon({ "costs.sessions": () => answer }).port),
      { timeoutMs: 3_000 },
    );
    expect(result.out).toEqual([JSON.stringify(answer, null, 2)]);
  });
});
