import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { resolve } from "node:path";
import { parseArgs } from "../../src/main.ts";
import { CLOSE, fakeDaemon, type Handlers, stopAll } from "../board/card-cli-helpers.ts";
import { flightdeckd } from "../support/cli-run.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const HASH = "abcdef0123456789abcdef";

const local = (over: Record<string, unknown> = {}) => ({
  id: "local",
  name: "Local",
  description: "a versioned persona",
  icon: null,
  model: null,
  effort: null,
  tools: null,
  permissionMode: null,
  body: "You work here.",
  scope: "project",
  hash: HASH,
  trusted: false,
  modified: false,
  ...over,
});

const listing = (persona: Record<string, unknown>) => ({
  personas: [persona],
  project: { path: "/w/api/.flightdeck/personas", errors: [] },
});

const HANDLERS: Handlers = {
  "personas.list": () => listing(local()),
  "personas.trust": () => local({ trusted: true }),
};

const asked = (daemon: ReturnType<typeof fakeDaemon>) =>
  daemon.calls.filter((call) => call.type.startsWith("personas."));

const TRUST = ["persona", "trust", "local", "--project-path", "/w/api", "--hash", "abcdef01"];

describe("flightdeckd persona trust (issue #3456)", () => {
  test("parseArgs: trust takes the persona, the project and the hash it was shown", () => {
    expect(parseArgs([...TRUST, "--json"])).toMatchObject({
      command: "persona",
      action: "trust",
      personaId: "local",
      projectPath: "/w/api",
      hash: "abcdef01",
      json: true,
    });
  });

  test("parseArgs: a trust without the project or a real hash is refused before anything is sent", () => {
    expect(() => parseArgs(["persona", "trust", "local", "--hash", "abcdef01"])).toThrow(
      /missing --project-path/,
    );
    expect(() => parseArgs(["persona", "trust", "local", "--project-path", "/w"])).toThrow(
      /missing --hash/,
    );
    for (const hash of ["abc", "not-a-hash-at-all", "ABCDEFGZ"]) {
      expect(() =>
        parseArgs(["persona", "trust", "local", "--project-path", "/w", "--hash", hash]),
      ).toThrow(/--hash: at least 8 hex characters/);
    }
    expect(() => parseArgs(["persona", "reset", "local", "--hash", "abcdef01"])).toThrow(
      /--hash: this flag only applies to flightdeckd persona trust/,
    );
    expect(() => parseArgs(["card", "list", "--hash", "abcdef01"])).toThrow(
      /--hash: this flag only applies to flightdeckd persona trust/,
    );
  });

  test("trust finds the persona, checks the hash and trusts that exact content", async () => {
    const daemon = fakeDaemon(HANDLERS);
    const run = await flightdeckd(TRUST, daemon.port);
    expect(run.code).toBe(0);
    expect(run.out).toEqual(["trusted local  abcdef012345"]);
    expect(asked(daemon)).toEqual([
      {
        type: "personas.list",
        payload: { scope: "project", projectPath: resolve("/w/api") },
      },
      {
        type: "personas.trust",
        payload: { projectPath: resolve("/w/api"), id: "local", hash: HASH },
      },
    ]);
  });

  test("trust --json prints the trusted persona", async () => {
    const run = await flightdeckd([...TRUST, "--json"], fakeDaemon(HANDLERS).port);
    expect(run.code).toBe(0);
    expect(run.out).toHaveLength(1);
    expect(run.out[0]?.startsWith("{")).toBe(true);
    expect(JSON.parse(run.out.join("\n"))).toEqual(local({ trusted: true }));
  });

  test("a hash that is not the persona's now exits 1 and trusts nothing: the file changed since it was read", async () => {
    const daemon = fakeDaemon(HANDLERS);
    const run = await flightdeckd(
      ["persona", "trust", "local", "--project-path", "/w/api", "--hash", "deadbeef"],
      daemon.port,
    );
    expect(run.code).toBe(1);
    expect(run.err.join("\n")).toContain("abcdef012345");
    expect(run.err.join("\n")).toContain("deadbeef");
    expect(asked(daemon).map((call) => call.type)).toEqual(["personas.list"]);
  });

  test("an id the project does not have exits 1 and trusts nothing", async () => {
    const daemon = fakeDaemon({ "personas.list": () => listing(local({ id: "other" })) });
    const run = await flightdeckd(TRUST, daemon.port);
    expect(run.code).toBe(1);
    expect(run.err.join("\n")).toContain("no project persona local");
    expect(asked(daemon).map((call) => call.type)).toEqual(["personas.list"]);
  });

  test("a persona that is already trusted says so and writes nothing", async () => {
    const daemon = fakeDaemon({ "personas.list": () => listing(local({ trusted: true })) });
    const run = await flightdeckd(TRUST, daemon.port);
    expect(run.code).toBe(0);
    expect(run.out).toEqual(["local is already trusted"]);
    expect(asked(daemon).map((call) => call.type)).toEqual(["personas.list"]);
  });

  test("a daemon that dies after the trust was sent: exit 2, and it may or may not have gone in", async () => {
    const daemon = fakeDaemon({ ...HANDLERS, "personas.trust": () => CLOSE });
    const run = await flightdeckd(TRUST, daemon.port);
    expect(run.code).toBe(2);
    expect(run.err.join("\n")).toContain("may or may not");
  });
});
