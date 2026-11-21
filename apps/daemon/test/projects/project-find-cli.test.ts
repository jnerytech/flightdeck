import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { resolve } from "node:path";
import { projectCliArgs } from "../../src/cli/domain/project-args.ts";
import type { CliResult } from "../../src/daemon-client/index.ts";
import { parseArgs } from "../../src/main.ts";
import { runProjectCli } from "../../src/projects/index.ts";
import { config, fakeDaemon, stopAll } from "../board/card-cli-helpers.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const text = (r: CliResult) => [...r.out, ...r.err].join("\n");
/** The parser appends the usage text, which names every flag: the refusal is the line before it. */
const firstLine = (error: unknown) => (error as Error).message.split("\n")[0];
/** What the runner would take, or what the parser refused with: a wrong parse fails an assertion. */
function runnerArgs(argv: string[]): unknown {
  try {
    return projectCliArgs(parseArgs(argv));
  } catch (error) {
    return { refusedWith: firstLine(error) };
  }
}
const refusedWith = (argv: string[], word: string) =>
  expect(runnerArgs(argv)).toMatchObject({ refusedWith: expect.stringContaining(word) });
const calls = (daemon: ReturnType<typeof fakeDaemon>, type: string) =>
  daemon.calls.filter((c) => c.type === type);

const URL = "https://example.com/acme/api.git";
const CLONE = ["project", "clone", URL, "--root", "/srv/code", "--confirm"];

describe("flightdeckd project scan: the words (issue #3737)", () => {
  test("takes an optional depth and hands it to the runner", () => {
    expect(runnerArgs(["project", "scan"])).toEqual({ action: "scan" });
    expect(runnerArgs(["project", "scan", "--depth", "2", "--json"])).toEqual({
      action: "scan",
      depth: 2,
      json: true,
    });
  });

  test("refuses a depth outside 1 to 3 or that is not a whole number, before it connects", () => {
    refusedWith(["project", "scan", "--depth", "4"], "--depth");
    refusedWith(["project", "scan", "--depth", "0"], "--depth");
    refusedWith(["project", "scan", "--depth", "1.5"], "--depth");
    refusedWith(["project", "scan", "--depth", "deep"], "--depth");
  });

  test("takes no folder, and refuses the flags of clone", () => {
    refusedWith(["project", "scan", "/srv/code"], "project scan");
    refusedWith(["project", "scan", "--root", "/srv/code"], "only applies");
    refusedWith(["project", "scan", "--confirm"], "only applies");
  });
});

describe("flightdeckd project clone: the words (issue #3737)", () => {
  test("takes the url, the root, an optional name and the confirm, and hands them to the runner", () => {
    expect(runnerArgs(CLONE)).toEqual({
      action: "clone",
      url: URL,
      root: "/srv/code",
      confirm: true,
    });
    expect(runnerArgs([...CLONE, "--name", "api", "--json"])).toEqual({
      action: "clone",
      url: URL,
      root: "/srv/code",
      name: "api",
      confirm: true,
      json: true,
    });
  });

  test("needs --confirm, a root and exactly one url", () => {
    refusedWith(["project", "clone", URL, "--root", "/srv/code"], "needs --confirm");
    refusedWith(["project", "clone", URL, "--confirm"], "--root");
    refusedWith(["project", "clone", "--root", "/srv/code", "--confirm"], "missing the url");
    refusedWith(
      [
        "project",
        "clone",
        URL,
        "https://example.com/other.git",
        "--root",
        "/srv/code",
        "--confirm",
      ],
      "one url",
    );
  });

  test("refuses a url or a name of a length the daemon refuses, before it connects", () => {
    refusedWith(
      ["project", "clone", `https://example.com/${"a".repeat(2040)}`, "--root", "/r", "--confirm"],
      "url",
    );
    refusedWith([...CLONE, "--name", "a".repeat(101)], "--name");
    refusedWith([...CLONE, "--name", "  "], "--name");
  });

  test("refuses --depth, and a relative root for another host", () => {
    refusedWith([...CLONE, "--depth", "2"], "only applies");
    refusedWith(
      ["project", "clone", URL, "--root", "code", "--confirm", "--host", "pi"],
      "absolute",
    );
    expect(
      runnerArgs(["project", "clone", URL, "--root", "/srv/code", "--confirm", "--host", "pi"]),
    ).toMatchObject({ action: "clone" });
  });
});

describe("flightdeckd project scan (issue #3737)", () => {
  const found = {
    repos: [
      { name: "api", path: "/srv/code/api", root: "/srv/code" },
      { name: "web", path: "/srv/code/web", root: "/srv/code" },
    ],
    truncated: false,
  };

  test("asks projects.scan with the depth the person gave, and prints a line a repository", async () => {
    const daemon = fakeDaemon({ "projects.scan": () => found });
    const result = await runProjectCli({ action: "scan", depth: 2 }, config(daemon.port));
    expect(result.code).toBe(0);
    expect(calls(daemon, "projects.scan")[0]?.payload).toEqual({ depth: 2 });
    expect(result.out).toEqual(["api  /srv/code/api", "web  /srv/code/web"]);
  });

  test("sends no depth when none was given, and says when the scan stopped at its cap", async () => {
    const daemon = fakeDaemon({ "projects.scan": () => ({ ...found, truncated: true }) });
    const result = await runProjectCli({ action: "scan" }, config(daemon.port));
    expect(calls(daemon, "projects.scan")[0]?.payload).toEqual({});
    expect(text(result)).toContain("stopped at its cap");
  });

  test("says so when no repository is found, and --json prints the daemon's answer", async () => {
    const empty = fakeDaemon({ "projects.scan": () => ({ repos: [], truncated: false }) });
    const none = await runProjectCli({ action: "scan" }, config(empty.port));
    expect(none.code).toBe(0);
    expect(text(none)).toContain("no git repositories");
    const daemon = fakeDaemon({ "projects.scan": () => found });
    const printed = await runProjectCli({ action: "scan", json: true }, config(daemon.port));
    expect(JSON.parse(printed.out.join("\n"))).toEqual(found);
  });

  test("is a read: a scan that got no answer exits 2 without saying a write may have happened", async () => {
    const silent = fakeDaemon({});
    const result = await runProjectCli({ action: "scan" }, config(silent.port), { timeoutMs: 200 });
    expect(result.code).toBe(2);
    expect(text(result)).not.toContain("may or may not");
  });
});

describe("flightdeckd project clone (issue #3737)", () => {
  const args = { action: "clone", url: URL, root: "/srv/code", confirm: true } as const;

  test("sends the url, the root made absolute and the name, and says where it cloned", async () => {
    const daemon = fakeDaemon({ "projects.clone": () => ({ path: "/srv/code/api" }) });
    const result = await runProjectCli({ ...args, root: "code", name: "api" }, config(daemon.port));
    expect(result.code).toBe(0);
    expect(calls(daemon, "projects.clone")[0]?.payload).toEqual({
      url: URL,
      root: resolve("code"),
      name: "api",
    });
    expect(result.out).toEqual(["cloned into /srv/code/api"]);
  });

  test("leaves the name out when none was given, and --json prints the daemon's answer", async () => {
    const daemon = fakeDaemon({ "projects.clone": () => ({ path: "/srv/code/api" }) });
    const result = await runProjectCli({ ...args, json: true }, config(daemon.port));
    expect(calls(daemon, "projects.clone")[0]?.payload).toEqual({ url: URL, root: "/srv/code" });
    expect(JSON.parse(result.out.join("\n"))).toEqual({ path: "/srv/code/api" });
  });

  test("a root outside the allowed folders or a url the daemon refuses exits 1 with its reason", async () => {
    const daemon = fakeDaemon({
      "projects.clone": () => ({
        error: { code: "bad_request", message: "only https:// and ssh addresses are cloned" },
      }),
    });
    const result = await runProjectCli(args, config(daemon.port));
    expect(result.code).toBe(1);
    expect(text(result)).toContain("only https:// and ssh addresses are cloned");
  });

  test("a clone that got no answer exits 2 and says it may or may not have happened", async () => {
    const silent = fakeDaemon({});
    const result = await runProjectCli(args, config(silent.port), { timeoutMs: 200 });
    expect(result.code).toBe(2);
    expect(text(result)).toContain("may or may not");
  });
});
