import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { parseArgs } from "../../src/main.ts";
import { CLOSE, fakeDaemon, stopAll } from "../board/card-cli-helpers.ts";
import { flightdeckd } from "../support/cli-run.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const TAIL = {
  lines: ["2026-11-21T10:00:00Z info daemon started", "2026-11-21T10:00:01Z warn quota slow"],
  path: "/home/u/.flightdeck/flightdeckd.log",
};

const printed = (out: string[]) => {
  try {
    return JSON.parse(out.join("\n")) as unknown;
  } catch {
    return null;
  }
};

const callsOf = (daemon: ReturnType<typeof fakeDaemon>) =>
  daemon.calls.filter((c) => c.type === "logs.tail").map((c) => c.payload);

describe("flightdeckd logs tail (issue #3736)", () => {
  test("it prints the last lines of the log, and asks for the daemon's default when --lines is not given", async () => {
    const daemon = fakeDaemon({ "logs.tail": () => TAIL });
    const run = await flightdeckd(["logs", "tail"], daemon.port);
    expect({ code: run.code, out: run.out, err: run.err }).toEqual({
      code: 0,
      out: TAIL.lines,
      err: [],
    });
    expect(callsOf(daemon)).toEqual([{}]);
  });

  test("--lines asks for that many lines", async () => {
    const daemon = fakeDaemon({ "logs.tail": () => TAIL });
    await flightdeckd(["logs", "tail", "--lines", "500"], daemon.port);
    await flightdeckd(["logs", "tail", "--lines", "1"], daemon.port);
    expect(callsOf(daemon)).toEqual([{ lines: 500 }, { lines: 1 }]);
  });

  test("--json prints the path and the lines", async () => {
    const daemon = fakeDaemon({ "logs.tail": () => TAIL });
    const run = await flightdeckd(["logs", "tail", "--json"], daemon.port);
    expect(run.code).toBe(0);
    expect(printed(run.out)).toEqual(TAIL);
  });

  test("an empty log says so, with --json an empty list", async () => {
    const daemon = fakeDaemon({ "logs.tail": () => ({ lines: [], path: TAIL.path }) });
    const text = await flightdeckd(["logs", "tail"], daemon.port);
    const json = await flightdeckd(["logs", "tail", "--json"], daemon.port);
    expect({ code: text.code, out: text.out }).toEqual({ code: 0, out: ["no log lines"] });
    expect(printed(json.out)).toEqual({ lines: [], path: TAIL.path });
  });

  test("a line of the log cannot drive the terminal", async () => {
    const daemon = fakeDaemon({
      "logs.tail": () => ({ lines: ["\u001b[2Jwiped"], path: TAIL.path }),
    });
    const run = await flightdeckd(["logs", "tail"], daemon.port);
    expect(run.out.join("\n")).toContain("wiped");
    expect(run.out.join("\n").includes("\u001b")).toBe(false);
  });

  test("a --lines outside 1 to 500, or not a whole number, is exit 1 and connects to nothing", async () => {
    const daemon = fakeDaemon({ "logs.tail": () => TAIL });
    for (const bad of ["0", "501", "-1", "abc", "1e2", "0x10", "5.5"]) {
      const run = await flightdeckd(["logs", "tail", "--lines", bad], daemon.port);
      expect({ bad, code: run.code }).toEqual({ bad, code: 1 });
      expect(run.err.join("\n")).toContain("--lines needs a whole number from 1 to 500");
    }
    expect(daemon.calls).toEqual([]);
  });

  test("a closed connection is exit 2", async () => {
    const daemon = fakeDaemon({ "logs.tail": () => CLOSE });
    expect((await flightdeckd(["logs", "tail"], daemon.port)).code).toBe(2);
  });
});

describe("flightdeckd logs words (issue #3736)", () => {
  const argsOf = (argv: string[]) => {
    try {
      return parseArgs(argv);
    } catch (error) {
      return { refusedWith: (error as Error).message };
    }
  };
  const refused = (argv: string[]) => (argsOf(argv) as { refusedWith?: string }).refusedWith;

  test("`logs tail [--lines n]` takes --host and --json", () => {
    expect(argsOf(["logs", "tail", "--lines", "20", "--host", "pi", "--json"])).toMatchObject({
      command: "logs",
      action: "tail",
      logLines: 20,
      host: "pi",
      json: true,
    });
  });

  test("a missing or other verb, and the flags of other commands, are refused", () => {
    expect(refused(["logs"])).toContain("invalid logs action");
    expect(refused(["logs", "clear"])).toContain("invalid logs action");
    expect(refused(["logs", "tail", "--limit", "5"])).toContain("--limit");
  });

  test("review's --lines still reads a range", () => {
    expect(
      argsOf(["review", "add", "t", "--path", "a.ts", "--lines", "10-12", "--body", "x"]),
    ).toMatchObject({ reviewLines: { start: 10, end: 12 } });
  });
});
