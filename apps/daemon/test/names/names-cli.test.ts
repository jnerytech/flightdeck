import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { parseArgs } from "../../src/main.ts";
import { CLOSE, fakeDaemon, stopAll } from "../board/card-cli-helpers.ts";
import { flightdeckd } from "../support/cli-run.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const NAMES = [
  {
    sessionId: "s1",
    display: "api · dev · 1",
    alias: "api-dev-1",
    aliases: ["api-dev-1", "a1"],
    project: "api",
    persona: "dev",
    number: 1,
    cardNumber: null,
    standard: true,
    team: { name: "core", role: "worker", number: 1 },
  },
  {
    sessionId: "ext-1",
    display: "api work",
    alias: "api-2",
    aliases: ["api-2"],
    project: "api",
    persona: "geral",
    number: 2,
    cardNumber: 7,
  },
];

const printed = (out: string[]) => {
  try {
    return JSON.parse(out.join("\n")) as unknown;
  } catch {
    return null;
  }
};

describe("flightdeckd names list (issue #3735)", () => {
  test("one line each: the alias, the name shown and the session it names", async () => {
    const daemon = fakeDaemon({ "names.list": () => ({ names: NAMES }) });
    const run = await flightdeckd(["names", "list"], daemon.port);
    expect({ code: run.code, out: run.out, err: run.err }).toEqual({
      code: 0,
      out: ["api-dev-1  api · dev · 1  s1  (also a1)", "api-2  api work  ext-1"],
      err: [],
    });
    expect(daemon.calls.filter((c) => c.type === "names.list").map((c) => c.payload)).toEqual([{}]);
  });

  test("--json prints every key of each name, null for what an older daemon leaves out", async () => {
    const daemon = fakeDaemon({ "names.list": () => ({ names: NAMES }) });
    const run = await flightdeckd(["names", "list", "--json"], daemon.port);
    expect(run.code).toBe(0);
    expect(printed(run.out)).toEqual([NAMES[0], { ...NAMES[1], standard: null, team: null }]);
  });

  test("none is an empty list and exit 0; a closed connection is exit 2", async () => {
    const empty = fakeDaemon({ "names.list": () => ({ names: [] }) });
    const gone = fakeDaemon({ "names.list": () => CLOSE });
    const text = await flightdeckd(["names", "list"], empty.port);
    const json = await flightdeckd(["names", "list", "--json"], empty.port);
    expect({ code: text.code, out: text.out }).toEqual({ code: 0, out: ["no names"] });
    expect({ code: json.code, out: printed(json.out) }).toEqual({ code: 0, out: [] });
    expect((await flightdeckd(["names", "list"], gone.port)).code).toBe(2);
  });

  test("`names list` takes --host and --json; a missing or other verb is refused", () => {
    expect(parseArgs(["names", "list", "--host", "pi", "--json"])).toMatchObject({
      command: "names",
      action: "list",
      host: "pi",
      json: true,
    });
    expect(() => parseArgs(["names"])).toThrow("invalid names action");
    expect(() => parseArgs(["names", "set"])).toThrow("invalid names action");
  });
});
