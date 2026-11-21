import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { parseArgs } from "../../src/main.ts";
import { CLOSE, fakeDaemon, stopAll } from "../board/card-cli-helpers.ts";
import { flightdeckd } from "../support/cli-run.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const R1 = {
  tag: "v1.4.0",
  title: "Flightdeck 1.4.0",
  publishedAt: "2026-11-20T10:00:00Z",
  url: "https://github.com/jnerytech/flightdeck/releases/tag/v1.4.0",
  highlights: ["Faster boot", "A new vault report"],
};
const R2 = {
  tag: "v1.3.0",
  title: "Flightdeck 1.3.0",
  publishedAt: "2026-11-10T10:00:00Z",
  url: "https://github.com/jnerytech/flightdeck/releases/tag/v1.3.0",
  highlights: [],
};

const printed = (out: string[]) => {
  try {
    return JSON.parse(out.join("\n")) as unknown;
  } catch {
    return null;
  }
};

const callsOf = (daemon: ReturnType<typeof fakeDaemon>) =>
  daemon.calls.filter((c) => c.type === "releases.list").map((c) => c.payload);

describe("flightdeckd releases list (issue #3736)", () => {
  test("one block each: the tag, the date and the title, then its highlights", async () => {
    const daemon = fakeDaemon({ "releases.list": () => ({ releases: [R1, R2] }) });
    const run = await flightdeckd(["releases", "list"], daemon.port);
    expect({ code: run.code, out: run.out, err: run.err }).toEqual({
      code: 0,
      out: [
        "2 releases",
        "  v1.4.0  2026-11-20T10:00:00Z  Flightdeck 1.4.0",
        "    - Faster boot",
        "    - A new vault report",
        "  v1.3.0  2026-11-10T10:00:00Z  Flightdeck 1.3.0",
      ],
      err: [],
    });
    expect(callsOf(daemon)).toEqual([{}]);
  });

  test("--limit asks for that many", async () => {
    const daemon = fakeDaemon({ "releases.list": () => ({ releases: [] }) });
    await flightdeckd(["releases", "list", "--limit", "20"], daemon.port);
    await flightdeckd(["releases", "list", "--limit", "1"], daemon.port);
    expect(callsOf(daemon)).toEqual([{ limit: 20 }, { limit: 1 }]);
  });

  test("--json prints a row each with every key, and none is an empty list", async () => {
    const daemon = fakeDaemon({ "releases.list": () => ({ releases: [R1, R2] }) });
    const empty = fakeDaemon({ "releases.list": () => ({ releases: [] }) });
    const json = await flightdeckd(["releases", "list", "--json"], daemon.port);
    const none = await flightdeckd(["releases", "list", "--json"], empty.port);
    const text = await flightdeckd(["releases", "list"], empty.port);
    expect(printed(json.out)).toEqual([R1, R2]);
    expect({ code: none.code, out: printed(none.out) }).toEqual({ code: 0, out: [] });
    expect(text.out).toEqual(["no releases"]);
  });

  test("the words of a release cannot drive the terminal", async () => {
    const daemon = fakeDaemon({
      "releases.list": () => ({
        releases: [{ ...R1, title: "\u001b[2Jwiped", highlights: ["\u001b[31mred"] }],
      }),
    });
    const run = await flightdeckd(["releases", "list"], daemon.port);
    expect(run.out.join("\n")).toContain("wiped");
    expect(run.out.join("\n").includes("\u001b")).toBe(false);
  });

  test("a --limit outside 1 to 20, or not a whole number, is exit 1 and connects to nothing", async () => {
    const daemon = fakeDaemon({ "releases.list": () => ({ releases: [] }) });
    for (const bad of ["0", "21", "abc", "1e1"]) {
      const run = await flightdeckd(["releases", "list", "--limit", bad], daemon.port);
      expect({ bad, code: run.code }).toEqual({ bad, code: 1 });
      expect(run.err.join("\n")).toContain("--limit needs a whole number from 1 to 20");
    }
    expect(daemon.calls).toEqual([]);
  });

  test("a closed connection is exit 2", async () => {
    const daemon = fakeDaemon({ "releases.list": () => CLOSE });
    expect((await flightdeckd(["releases", "list"], daemon.port)).code).toBe(2);
  });
});

describe("flightdeckd releases words (issue #3736)", () => {
  const argsOf = (argv: string[]) => {
    try {
      return parseArgs(argv);
    } catch (error) {
      return { refusedWith: (error as Error).message };
    }
  };
  const refused = (argv: string[]) => (argsOf(argv) as { refusedWith?: string }).refusedWith;

  test("`releases list [--limit n]` takes --host and --json", () => {
    expect(argsOf(["releases", "list", "--limit", "5", "--host", "pi", "--json"])).toMatchObject({
      command: "releases",
      action: "list",
      limit: 5,
      host: "pi",
      json: true,
    });
  });

  test("a missing or other verb, and a flag that is not its own, are refused", () => {
    expect(refused(["releases"])).toContain("invalid releases action");
    expect(refused(["releases", "get"])).toContain("invalid releases action");
    expect(refused(["releases", "list", "--lines", "5"])).toContain("--lines");
  });
});
