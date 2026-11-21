import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { parseArgs } from "../../src/main.ts";
import { CLOSE, fakeDaemon, type Handlers, stopAll } from "../board/card-cli-helpers.ts";
import { flightdeckd } from "../support/cli-run.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const A1 = {
  id: "dependabot:12",
  kind: "dependabot",
  number: 12,
  severity: "critical",
  title: "lodash prototype pollution",
  location: "package.json",
  url: "https://github.com/o/r/security/dependabot/12",
  text: "lodash before 4.17.21 allows prototype pollution",
};
const A2 = {
  id: "code-scanning:3",
  kind: "code-scanning",
  number: 3,
  severity: "high",
  title: "SQL injection",
  location: null,
  url: "",
  text: "query built from input",
};

const alerts = (over: Handlers = {}): Handlers => ({
  "project.list": () => ({
    projects: [
      { id: "p1", name: "api" },
      { id: "p2", name: "web" },
    ],
    maxParallelRuns: 2,
  }),
  "alert.list": () => ({ alerts: [A1, A2], unavailable: [] }),
  ...over,
});

const printed = (out: string[]) => {
  try {
    return JSON.parse(out.join("\n")) as unknown;
  } catch {
    return null;
  }
};

const callsOf = (daemon: ReturnType<typeof fakeDaemon>) =>
  daemon.calls.filter((c) => c.type === "alert.list").map((c) => c.payload);

describe("flightdeckd alert list (issue #3736)", () => {
  test("one line each: the severity, the kind and number, the title and where", async () => {
    const daemon = fakeDaemon(alerts());
    const run = await flightdeckd(["alert", "list", "api"], daemon.port);
    expect({ code: run.code, out: run.out, err: run.err }).toEqual({
      code: 0,
      out: [
        "2 open alerts in api",
        "  critical  dependabot#12  lodash prototype pollution  package.json",
        "  high  code-scanning#3  SQL injection",
      ],
      err: [],
    });
    expect(callsOf(daemon)).toEqual([{ projectId: "p1" }]);
  });

  test("the project is its id or its name, without regard to case", async () => {
    const daemon = fakeDaemon(alerts());
    await flightdeckd(["alert", "list", "p2"], daemon.port);
    await flightdeckd(["alert", "list", "WEB"], daemon.port);
    expect(callsOf(daemon)).toEqual([{ projectId: "p2" }, { projectId: "p2" }]);
  });

  test("--json prints every key of each alert and of each source that could not be read", async () => {
    const daemon = fakeDaemon(
      alerts({
        "alert.list": () => ({
          alerts: [A1],
          unavailable: [{ kind: "code-scanning", reason: "not_signed_in" }],
        }),
      }),
    );
    const run = await flightdeckd(["alert", "list", "api", "--json"], daemon.port);
    expect(run.code).toBe(0);
    expect(printed(run.out)).toEqual({
      alerts: [A1],
      unavailable: [{ kind: "code-scanning", reason: "not_signed_in" }],
    });
  });

  test("a source that could not be read is a line of its own, and none open says so", async () => {
    const daemon = fakeDaemon(
      alerts({
        "alert.list": () => ({
          alerts: [],
          unavailable: [{ kind: "dependabot", reason: "gh_missing" }],
        }),
      }),
    );
    const run = await flightdeckd(["alert", "list", "api"], daemon.port);
    expect(run.out).toEqual([
      "no open alerts in api",
      "  dependabot alerts could not be read: gh is not installed",
    ]);
  });

  test("a title from a scanner cannot drive the terminal", async () => {
    const daemon = fakeDaemon(
      alerts({
        "alert.list": () => ({
          alerts: [{ ...A1, title: "\u001b[2Jwiped" }],
          unavailable: [],
        }),
      }),
    );
    const run = await flightdeckd(["alert", "list", "api"], daemon.port);
    expect(run.out.join("\n")).toContain("wiped");
    expect(run.out.join("\n").includes("\u001b")).toBe(false);
  });

  test("an unknown project is exit 1 with the projects there, and asks the daemon for no alerts", async () => {
    const daemon = fakeDaemon(alerts());
    const run = await flightdeckd(["alert", "list", "nope"], daemon.port);
    expect(run.code).toBe(1);
    expect(run.err.join("\n")).toContain('no project named "nope"; the projects here: api, web');
    expect(callsOf(daemon)).toEqual([]);
  });

  test("a host that does not read alerts is exit 1 with the daemon's text; a closed connection is exit 2", async () => {
    const off = fakeDaemon(
      alerts({
        "alert.list": () => ({ error: { code: "feature_off", message: "alerts is off" } }),
      }),
    );
    const gone = fakeDaemon(alerts({ "alert.list": () => CLOSE }));
    const refused = await flightdeckd(["alert", "list", "api"], off.port);
    expect(refused.code).toBe(1);
    expect(refused.err.join("\n")).toContain("alerts is off");
    expect((await flightdeckd(["alert", "list", "api"], gone.port)).code).toBe(2);
  });
});

describe("flightdeckd alert words (issue #3736)", () => {
  const argsOf = (argv: string[]) => {
    try {
      return parseArgs(argv);
    } catch (error) {
      return { refusedWith: (error as Error).message };
    }
  };
  const refused = (argv: string[]) => (argsOf(argv) as { refusedWith?: string }).refusedWith;

  test("`alert list <project>` takes --host and --json", () => {
    expect(argsOf(["alert", "list", "api", "--host", "pi", "--json"])).toMatchObject({
      command: "alert",
      action: "list",
      alertProject: "api",
      host: "pi",
      json: true,
    });
  });

  test("a missing verb or project, and a flag that is not its own, are refused", () => {
    expect(refused(["alert"])).toContain("invalid alert action");
    expect(refused(["alert", "dismiss"])).toContain("invalid alert action");
    expect(refused(["alert", "list"])).toContain("the project");
    expect(refused(["alert", "list", "api", "--limit", "5"])).toContain("--limit");
  });
});
