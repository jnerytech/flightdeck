import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "../../src/main.ts";
import { CLOSE, fakeDaemon, type Handlers, stopAll } from "../board/card-cli-helpers.ts";
import { flightdeckd } from "../support/cli-run.ts";
import { tempDir } from "../support/helpers.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const saved = (over: Record<string, unknown> = {}) => ({
  id: "architect",
  name: "Architect",
  description: "designs",
  icon: null,
  model: null,
  effort: null,
  tools: null,
  permissionMode: null,
  body: "You design.",
  scope: "host",
  hash: null,
  trusted: true,
  modified: false,
  ...over,
});

const HANDLERS: Handlers = {
  "personas.save": () => saved(),
  "personas.remove": () => undefined,
  "personas.reset": () => saved({ scope: "pack" }),
  "personas.publishAgent": () => ({ path: "/w/api/.claude/agents/persona-architect.md" }),
};

const writes = (daemon: ReturnType<typeof fakeDaemon>) =>
  daemon.calls.filter((call) => call.type.startsWith("personas."));

const SAVE = ["persona", "save", "architect", "--scope", "host", "--name", "Architect"];

describe("flightdeckd persona: the changing verbs (issue #3456)", () => {
  test("parseArgs: save takes the persona's fields as flags", () => {
    expect(
      parseArgs([
        ...SAVE,
        "--description",
        "designs",
        "--body",
        "You design.",
        "--model",
        "opus",
        "--effort",
        "high",
        "--tools",
        "Read,Grep",
        "--permission-mode",
        "plan",
        "--icon",
        "compass",
        "--project-path",
        "/w/api",
        "--json",
      ]),
    ).toMatchObject({
      command: "persona",
      action: "save",
      personaId: "architect",
      scope: "host",
      personaName: "Architect",
      description: "designs",
      body: "You design.",
      model: "opus",
      effort: "high",
      tools: ["Read", "Grep"],
      permissionMode: "plan",
      icon: "compass",
      projectPath: "/w/api",
      json: true,
    });
  });

  test("parseArgs: remove, reset and publish-agent and what each takes", () => {
    expect(
      parseArgs(["persona", "remove", "qa", "--scope", "project", "--project-path", "p"]),
    ).toMatchObject({ action: "remove", personaId: "qa", scope: "project", projectPath: "p" });
    expect(parseArgs(["persona", "reset", "qa", "--language", "en"])).toMatchObject({
      action: "reset",
      personaId: "qa",
      language: "en",
    });
    expect(
      parseArgs(["persona", "publish-agent", "qa", "--project-path", "p", "--confirm"]),
    ).toMatchObject({ action: "publish-agent", personaId: "qa", projectPath: "p", confirm: true });
  });

  test("parseArgs: a save without what the daemon needs is refused before anything is sent", () => {
    const base = ["persona", "save", "architect"];
    expect(() => parseArgs([...base, "--name", "A", "--description", "d", "--body", "b"])).toThrow(
      /missing --scope/,
    );
    expect(() =>
      parseArgs([...base, "--scope", "all", "--name", "A", "--description", "d", "--body", "b"]),
    ).toThrow(/--scope: host or project/);
    expect(() =>
      parseArgs([...base, "--scope", "host", "--description", "d", "--body", "b"]),
    ).toThrow(/missing --name/);
    expect(() => parseArgs([...base, "--scope", "host", "--name", "A", "--body", "b"])).toThrow(
      /missing --description/,
    );
    expect(() =>
      parseArgs([...base, "--scope", "host", "--name", "A", "--description", "d"]),
    ).toThrow(/missing --body or --body-file/);
    expect(() =>
      parseArgs([
        ...base,
        "--scope",
        "host",
        "--name",
        "A",
        "--description",
        "d",
        "--body",
        "b",
        "--body-file",
        "f.md",
      ]),
    ).toThrow(/--body or --body-file, not both/);
    expect(() =>
      parseArgs([
        ...base,
        "--scope",
        "host",
        "--name",
        "A",
        "--description",
        "d",
        "--body",
        "b",
        "--effort",
        "extreme",
      ]),
    ).toThrow(/--effort: /);
    expect(() => parseArgs(["persona", "remove", "qa"])).toThrow(/missing --scope/);
    expect(() => parseArgs(["persona", "remove", "qa", "--scope", "all"])).toThrow(
      /--scope: host or project/,
    );
    expect(() => parseArgs(["persona", "publish-agent", "qa", "--confirm"])).toThrow(
      /missing --project-path/,
    );
  });

  test("parseArgs: a flag belongs to its verb", () => {
    expect(() => parseArgs(["persona", "list", "--name", "x"])).toThrow(
      /--name: this flag only applies to flightdeckd persona save/,
    );
    expect(() => parseArgs(["persona", "show", "qa", "--body", "x"])).toThrow(
      /--body: this flag only applies to flightdeckd persona save/,
    );
    expect(() => parseArgs(["persona", "reset", "qa", "--confirm"])).toThrow(
      /--confirm: this flag only applies to flightdeckd persona publish-agent/,
    );
    expect(() => parseArgs(["persona", "reset", "qa", "--scope", "host"])).toThrow(
      /--scope: this flag only applies to flightdeckd persona list, save, remove/,
    );
    expect(() => parseArgs(["card", "list", "--model", "opus"])).toThrow(
      /--model: this flag only applies to flightdeckd persona save/,
    );
  });

  test("save sends the persona with the folder made absolute, and says where it was saved", async () => {
    const daemon = fakeDaemon(HANDLERS);
    const run = await flightdeckd(
      [
        ...SAVE,
        "--description",
        "designs",
        "--body",
        "You design.",
        "--tools",
        "Read,Grep",
        "--effort",
        "high",
        "--project-path",
        "api",
      ],
      daemon.port,
    );
    expect(run.code).toBe(0);
    expect(run.out).toEqual(["saved architect (host)"]);
    expect(writes(daemon)).toEqual([
      {
        type: "personas.save",
        payload: {
          scope: "host",
          projectPath: resolve("api"),
          persona: {
            id: "architect",
            name: "Architect",
            description: "designs",
            body: "You design.",
            tools: ["Read", "Grep"],
            effort: "high",
          },
        },
      },
    ]);
  });

  test("save --body-file sends the file's text whole, and --json prints the daemon's answer", async () => {
    const file = join(tempDir("persona-body-"), "body.md");
    writeFileSync(file, "# Role\n\nYou design.\n");
    const daemon = fakeDaemon(HANDLERS);
    const run = await flightdeckd(
      [...SAVE, "--description", "designs", "--body-file", file, "--json"],
      daemon.port,
    );
    expect(run.code).toBe(0);
    expect(run.out).toHaveLength(1);
    expect(JSON.parse(run.out.join("\n"))).toEqual(saved());
    const sent = writes(daemon)[0]?.payload as { persona: { body: string } };
    expect(sent.persona.body).toBe("# Role\n\nYou design.\n");
  });

  test("save with a body file that cannot be read exits 1 and sends nothing", async () => {
    const daemon = fakeDaemon(HANDLERS);
    const run = await flightdeckd(
      [...SAVE, "--description", "d", "--body-file", "/no/such/body.md"],
      daemon.port,
    );
    expect(run.code).toBe(1);
    expect(run.err.join("\n")).toContain("cannot read the body file /no/such/body.md");
    expect(writes(daemon)).toEqual([]);
  });

  test("save the daemon refuses (a secret in the text) exits 1 with its reason", async () => {
    const daemon = fakeDaemon({
      "personas.save": () => ({
        error: { code: "persona_secret", message: "the persona holds a secret" },
      }),
    });
    const run = await flightdeckd([...SAVE, "--description", "d", "--body", "b"], daemon.port);
    expect(run.code).toBe(1);
    expect(run.err.join("\n")).toContain("the persona holds a secret");
  });

  test("remove and reset say what they did, and --json says it as one object", async () => {
    const daemon = fakeDaemon(HANDLERS);
    const removed = await flightdeckd(["persona", "remove", "qa", "--scope", "host"], daemon.port);
    expect(removed.out).toEqual(["removed qa (host)"]);
    const removedJson = await flightdeckd(
      ["persona", "remove", "qa", "--scope", "host", "--json"],
      daemon.port,
    );
    expect(JSON.parse(removedJson.out.join("\n"))).toEqual({
      id: "qa",
      scope: "host",
      removed: true,
    });
    const reset = await flightdeckd(
      ["persona", "reset", "architect", "--language", "en"],
      daemon.port,
    );
    expect(reset.out).toEqual(["reset architect to the pack's version"]);
    expect(writes(daemon).map((call) => [call.type, call.payload])).toEqual([
      ["personas.remove", { scope: "host", id: "qa" }],
      ["personas.remove", { scope: "host", id: "qa" }],
      ["personas.reset", { id: "architect", language: "en" }],
    ]);
  });

  test("publish-agent without --confirm exits 1, says why and sends nothing", async () => {
    const daemon = fakeDaemon(HANDLERS);
    const run = await flightdeckd(
      ["persona", "publish-agent", "architect", "--project-path", "/w/api"],
      daemon.port,
    );
    expect(run.code).toBe(1);
    expect(run.err.join("\n")).toContain("writes .claude/agents/persona-architect.md");
    expect(run.err.join("\n")).toContain("--confirm");
    expect(writes(daemon)).toEqual([]);
  });

  test("publish-agent --confirm sends the yes and prints the file it wrote", async () => {
    const daemon = fakeDaemon(HANDLERS);
    const run = await flightdeckd(
      [
        "persona",
        "publish-agent",
        "architect",
        "--project-path",
        "/w/api",
        "--confirm",
        "--language",
        "en",
      ],
      daemon.port,
    );
    expect(run.code).toBe(0);
    expect(run.out).toEqual(["wrote /w/api/.claude/agents/persona-architect.md"]);
    expect(writes(daemon)).toEqual([
      {
        type: "personas.publishAgent",
        payload: { id: "architect", projectPath: "/w/api", language: "en", confirm: true },
      },
    ]);
  });

  test("a daemon that dies after a change was sent: exit 2, and the change may or may not have gone in", async () => {
    for (const argv of [
      [...SAVE, "--description", "d", "--body", "b"],
      ["persona", "remove", "qa", "--scope", "host"],
      ["persona", "reset", "qa"],
      ["persona", "publish-agent", "qa", "--project-path", "/w", "--confirm"],
    ]) {
      const daemon = fakeDaemon({
        "personas.save": () => CLOSE,
        "personas.remove": () => CLOSE,
        "personas.reset": () => CLOSE,
        "personas.publishAgent": () => CLOSE,
      });
      const run = await flightdeckd(argv, daemon.port);
      expect(run.code).toBe(2);
      expect(run.err.join("\n")).toContain("may or may not");
      expect(run.err.join("\n")).toContain("persona list");
    }
  });
});
