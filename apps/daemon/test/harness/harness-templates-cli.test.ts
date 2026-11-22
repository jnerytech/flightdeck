import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { parseArgs } from "../../src/main.ts";
import { CLOSE, fakeDaemon, type Handlers, stopAll } from "../board/card-cli-helpers.ts";
import { flightdeckd } from "../support/cli-run.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const TEMPLATES = [
  {
    id: "node-api",
    title: "Node API",
    files: ["CLAUDE.md", "agents/reviewer.md"],
    bytes: 2048,
  },
  { id: "docs", title: "Docs", files: ["CLAUDE.md"], bytes: 300 },
];

const OPEN: Handlers = {
  "harness.templates.list": () => ({ templates: TEMPLATES }),
  "harness.templates.delete": (payload) => ({ id: payload.id }),
};

const sent = (daemon: ReturnType<typeof fakeDaemon>, type: string) =>
  daemon.calls.filter((c) => c.type === type).map((c) => c.payload);

const parsed = (argv: string[]): Record<string, unknown> => {
  try {
    return { ...parseArgs(argv) };
  } catch (error) {
    return { refusal: String((error as Error).message).split("\n")[0] };
  }
};

describe("the harness arguments (issue #3738)", () => {
  test("harness templates list takes nothing, and delete takes an id and --confirm", () => {
    expect(parsed(["harness", "templates", "list", "--json", "--host", "pi"])).toMatchObject({
      command: "harness",
      action: "templates-list",
      json: true,
      host: "pi",
    });
    expect(parsed(["harness", "templates", "delete", "node-api", "--confirm"])).toMatchObject({
      command: "harness",
      action: "templates-delete",
      harnessWords: ["node-api"],
      confirm: true,
    });
  });

  test("delete without --confirm and a bad id are refused before any connection", () => {
    expect(parsed(["harness", "templates", "delete", "node-api"])).toHaveProperty(
      "refusal",
      expect.stringContaining("--confirm"),
    );
    for (const bad of ["Node_API", "-x", "../x", "a".repeat(41)]) {
      expect(parsed(["harness", "templates", "delete", bad, "--confirm"])).toHaveProperty(
        "refusal",
        expect.stringContaining("template id"),
      );
    }
    expect(parsed(["harness", "templates", "delete", "--confirm"])).toHaveProperty("refusal");
  });

  test("the words around the verbs are checked", () => {
    for (const line of [
      ["harness"],
      ["harness", "nope"],
      ["harness", "templates"],
      ["harness", "templates", "nope"],
      ["harness", "templates", "list", "extra"],
      ["harness", "templates", "delete", "a", "b", "--confirm"],
    ]) {
      expect(parsed(line)).toHaveProperty("refusal");
    }
  });

  test("--confirm goes with delete alone", () => {
    expect(parsed(["harness", "templates", "list", "--confirm"])).toHaveProperty(
      "refusal",
      expect.stringContaining("--confirm"),
    );
  });
});

describe("flightdeckd harness templates list (issue #3738)", () => {
  test("it prints the id, title, files and size of each template, never a content", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["harness", "templates", "list"], daemon.port);
    expect({ code: run.code, err: run.err }).toEqual({ code: 0, err: [] });
    expect(run.out).toEqual([
      "node-api  Node API  2 files  2048 bytes",
      "docs  Docs  1 file  300 bytes",
    ]);
  });

  test("--json prints the templates as one value, and an empty host says so", async () => {
    const json = await flightdeckd(
      ["harness", "templates", "list", "--json"],
      fakeDaemon(OPEN).port,
    );
    expect(JSON.parse(json.out.join("\n"))).toEqual({ templates: TEMPLATES });
    const none = fakeDaemon({ ...OPEN, "harness.templates.list": () => ({ templates: [] }) });
    const run = await flightdeckd(["harness", "templates", "list"], none.port);
    expect(run.out).toEqual(["no harness template on this host"]);
  });
});

describe("flightdeckd harness templates delete (issue #3738)", () => {
  test("it sends the id with confirm true and prints what it deleted", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(
      ["harness", "templates", "delete", "node-api", "--confirm"],
      daemon.port,
    );
    expect({ code: run.code, err: run.err }).toEqual({ code: 0, err: [] });
    expect(run.out).toEqual(["deleted harness template node-api"]);
    expect(sent(daemon, "harness.templates.delete")).toEqual([{ id: "node-api", confirm: true }]);
  });

  test("--json prints the id", async () => {
    const run = await flightdeckd(
      ["harness", "templates", "delete", "node-api", "--confirm", "--json"],
      fakeDaemon(OPEN).port,
    );
    expect(JSON.parse(run.out.join("\n"))).toEqual({ id: "node-api" });
  });

  test("a template the daemon does not know is exit 1 with its text", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "harness.templates.delete": () => ({
        error: { code: "not_found", message: "there is no harness template ghost" },
      }),
    });
    const run = await flightdeckd(
      ["harness", "templates", "delete", "ghost", "--confirm"],
      daemon.port,
    );
    expect([run.code, run.err.join("\n")]).toEqual([
      1,
      expect.stringContaining("no harness template ghost"),
    ]);
  });

  test("a connection lost while it deletes says it may or may not have happened", async () => {
    const daemon = fakeDaemon({ ...OPEN, "harness.templates.delete": () => CLOSE });
    const run = await flightdeckd(
      ["harness", "templates", "delete", "node-api", "--confirm"],
      daemon.port,
    );
    expect([run.code, run.err.join("\n").includes("may or may not")]).toEqual([2, true]);
  });

  test("no daemon is exit 2", async () => {
    const daemon = fakeDaemon(OPEN);
    const { port } = daemon;
    await stopAll();
    expect((await flightdeckd(["harness", "templates", "list"], port)).code).toBe(2);
  });
});
