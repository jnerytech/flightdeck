import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { runCostsCli } from "../../src/costs/index.ts";
import { parseArgs } from "../../src/main.ts";
import { config, fakeDaemon, stopAll } from "../board/card-cli-helpers.ts";
import { flightdeckd } from "../support/cli-run.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const text = (r: { out: string[]; err: string[] }) => [...r.out, ...r.err].join("\n");

describe("flightdeckd costs reprice (issue #3460)", () => {
  test("it asks the daemon to price every entry again and says how many entries it priced", async () => {
    const daemon = fakeDaemon({ "costs.reprice": () => ({ entries: 1204 }) });
    const result = await runCostsCli({ action: "reprice" }, config(daemon.port));
    expect({ code: result.code, out: result.out }).toEqual({
      code: 0,
      out: ["repriced 1204 entries with the price table of the config"],
    });
    expect(daemon.calls.filter((c) => c.type === "costs.reprice")).toEqual([
      { type: "costs.reprice", payload: {} },
    ]);
  });

  test("one entry is said in the singular", async () => {
    const daemon = fakeDaemon({ "costs.reprice": () => ({ entries: 1 }) });
    const result = await runCostsCli({ action: "reprice" }, config(daemon.port));
    expect(result.out).toEqual(["repriced 1 entry with the price table of the config"]);
  });

  test("--json prints the daemon's answer", async () => {
    const daemon = fakeDaemon({ "costs.reprice": () => ({ entries: 3 }) });
    const result = await runCostsCli({ action: "reprice", json: true }, config(daemon.port));
    expect(JSON.parse(result.out.join("\n"))).toEqual({ entries: 3 });
  });

  test("a refusal exits 1 with the daemon's code", async () => {
    const daemon = fakeDaemon({
      "costs.reprice": () => ({ error: { code: "invalid", message: "nope" } }),
    });
    const result = await runCostsCli({ action: "reprice" }, config(daemon.port));
    expect(result.code).toBe(1);
    expect(text(result)).toContain("nope");
  });

  test("a write that gets no answer exits 2 and says the costs may or may not have changed", async () => {
    const daemon = fakeDaemon({ "costs.reprice": () => undefined });
    const result = await runCostsCli({ action: "reprice" }, config(daemon.port), {
      timeoutMs: 300,
    });
    expect(result.code).toBe(2);
    expect(text(result)).toContain(
      "the costs may or may not have been priced again: check with `costs status` before trying again",
    );
  });
});

describe("costs reprice: the arguments (issue #3460)", () => {
  const parsed = (argv: string[]) => {
    try {
      return parseArgs(argv);
    } catch (error) {
      return { refusedWith: (error as Error).message };
    }
  };

  test("--confirm is read as the confirmation of a reprice", () => {
    expect(parsed(["costs", "reprice", "--confirm"])).toMatchObject({
      command: "costs",
      action: "reprice",
      confirm: true,
    });
  });

  test("without --confirm it is refused, and says what it rewrites", () => {
    expect(JSON.stringify(parsed(["costs", "reprice"]))).toContain(
      "costs reprice rewrites the cost of every entry: pass --confirm to do it",
    );
  });

  test("--confirm on another verb is refused, naming the verbs it belongs to", () => {
    expect(JSON.stringify(parsed(["costs", "status", "--confirm"]))).toContain(
      "--confirm: this flag only applies to flightdeckd costs reprice",
    );
  });

  test("a second command word after another command is refused, so a read cannot carry a reprice", () => {
    for (const argv of [
      ["quota", "get", "costs", "reprice", "--confirm"],
      ["quota", "watch", "costs", "reprice", "--confirm"],
      ["budget", "list", "costs", "reprice", "--confirm"],
      ["costs", "status", "costs", "reprice", "--confirm"],
    ])
      expect({
        argv,
        refused: JSON.stringify(parsed(argv)).includes("one command at a time"),
      }).toEqual({
        argv,
        refused: true,
      });
  });

  test("the day and filter flags do not apply to a reprice", () => {
    expect(
      JSON.stringify(parsed(["costs", "reprice", "--confirm", "--from", "2026-11-01"])),
    ).toContain("--from: this flag only applies to flightdeckd costs summary, export and roi");
  });
});

describe("flightdeckd costs reprice, as the terminal runs it (issue #3460)", () => {
  test("without --confirm it exits 1 and sends nothing", async () => {
    const daemon = fakeDaemon({ "costs.reprice": () => ({ entries: 1 }) });
    const result = await flightdeckd(["costs", "reprice"], daemon.port);
    expect(result.code).toBe(1);
    expect(daemon.calls.filter((c) => c.type === "costs.reprice")).toEqual([]);
  });

  test("with --confirm it reaches the daemon and exits 0", async () => {
    const daemon = fakeDaemon({ "costs.reprice": () => ({ entries: 2 }) });
    const result = await flightdeckd(["costs", "reprice", "--confirm"], daemon.port);
    expect(result.code).toBe(0);
    expect(daemon.calls.filter((c) => c.type === "costs.reprice")).toHaveLength(1);
  });
});
