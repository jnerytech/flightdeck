import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { resolve } from "node:path";
import { parseArgs } from "../../src/main.ts";
import { fakeDaemon, type Handlers, stopAll } from "../board/card-cli-helpers.ts";
import { flightdeckd } from "../support/cli-run.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const persona = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: `Persona ${id}`,
  description: `does ${id}`,
  icon: null,
  model: null,
  effort: null,
  tools: null,
  permissionMode: null,
  body: `You are ${id}.`,
  scope: "pack",
  hash: null,
  trusted: true,
  modified: false,
  ...over,
});

const LIST = {
  personas: [
    persona("architect"),
    persona("reviewer", { scope: "host", modified: true }),
    persona("local", { scope: "project", hash: "abcdef0123456789abcdef", trusted: false }),
  ],
  project: { path: "/w/api/.flightdeck/personas", errors: ["broken.md: no body"] },
};

const HANDLERS: Handlers = {
  "personas.list": () => LIST,
  "personas.resolve": ({ ref }) =>
    (ref as { id?: string }).id === "architect"
      ? {
          persona: persona("architect", {
            model: "opus",
            effort: "high",
            tools: ["Read", "Grep"],
            permissionMode: "plan",
            body: "You are the architect.\nKeep modules deep.",
          }),
          source: "pack",
          hash: null,
        }
      : { error: { code: "not_found", message: "no persona nope" } },
  "personas.subagents": () => ({
    agents: {
      "persona-architect": { description: "does architect", prompt: "You are architect." },
    },
    untrusted: ["local"],
  }),
};

const asked = (daemon: ReturnType<typeof fakeDaemon>) =>
  daemon.calls.filter((call) => call.type.startsWith("personas."));

describe("flightdeckd persona: the reading verbs (issue #3456)", () => {
  test("parseArgs: each verb and what it takes", () => {
    expect(parseArgs(["persona", "list"])).toMatchObject({ command: "persona", action: "list" });
    expect(
      parseArgs([
        "persona",
        "list",
        "--scope",
        "project",
        "--project-path",
        "/w/api",
        "--language",
        "en",
        "--json",
      ]),
    ).toMatchObject({
      action: "list",
      scope: "project",
      projectPath: "/w/api",
      language: "en",
      json: true,
    });
    expect(parseArgs(["persona", "show", "architect", "--language", "pt-BR"])).toMatchObject({
      action: "show",
      personaId: "architect",
      language: "pt-BR",
    });
    expect(parseArgs(["persona", "subagents", "--project-path", "/w/api"])).toMatchObject({
      action: "subagents",
      projectPath: "/w/api",
    });
  });

  test("parseArgs: a wrong verb, a missing id and a wrong value are refused with the usage", () => {
    expect(() => parseArgs(["persona", "nope"])).toThrow(/invalid persona action: nope/);
    expect(() => parseArgs(["persona"])).toThrow(/invalid persona action/);
    expect(() => parseArgs(["persona", "show"])).toThrow(/missing the persona/);
    expect(() => parseArgs(["persona", "list", "--scope", "all-of-them"])).toThrow(
      /--scope: host, project or all/,
    );
    expect(() => parseArgs(["persona", "list", "--language", "fr"])).toThrow(
      /--language: en or pt-BR/,
    );
  });

  test("parseArgs: --scope only goes with list, and both flags only with persona", () => {
    expect(() => parseArgs(["persona", "show", "architect", "--scope", "host"])).toThrow(
      /--scope: this flag only applies to flightdeckd persona list/,
    );
    expect(() => parseArgs(["card", "list", "--language", "en"])).toThrow(
      /--language: this flag only applies to flightdeckd card review/,
    );
    expect(() => parseArgs(["card", "list", "--scope", "host"])).toThrow(
      /--scope: this flag only applies to flightdeckd persona/,
    );
  });

  test("list --json prints the daemon's answer and sends what was asked, with the folder made absolute", async () => {
    const daemon = fakeDaemon(HANDLERS);
    const run = await flightdeckd(
      ["persona", "list", "--scope", "all", "--project-path", "api", "--language", "en", "--json"],
      daemon.port,
    );
    expect(run.code).toBe(0);
    expect(run.err).toEqual([]);
    expect(run.out).toHaveLength(1);
    expect(JSON.parse(run.out.join("\n"))).toEqual(LIST);
    expect(asked(daemon)).toEqual([
      {
        type: "personas.list",
        payload: { scope: "all", projectPath: resolve("api"), language: "en" },
      },
    ]);
  });

  test("list says each persona's id, where it lives and, for a project one, its hash and trust", async () => {
    const daemon = fakeDaemon(HANDLERS);
    const run = await flightdeckd(["persona", "list"], daemon.port);
    expect(run.code).toBe(0);
    expect(run.out).toEqual([
      "architect  pack  Persona architect",
      "reviewer  host  Persona reviewer  (edited)",
      "local  project  Persona local  abcdef012345  not trusted",
      "left out of /w/api/.flightdeck/personas: broken.md: no body",
    ]);
    expect(asked(daemon)).toEqual([{ type: "personas.list", payload: {} }]);
  });

  test("list with no persona says so", async () => {
    const daemon = fakeDaemon({ "personas.list": () => ({ personas: [], project: null }) });
    const run = await flightdeckd(["persona", "list"], daemon.port);
    expect(run.out).toEqual(["no personas"]);
  });

  test("list with no persona still names the project files that were left out", async () => {
    const daemon = fakeDaemon({
      "personas.list": () => ({
        personas: [],
        project: { path: "/w/api/.flightdeck/personas", errors: ["broken.md: no body"] },
      }),
    });
    const run = await flightdeckd(["persona", "list", "--scope", "project"], daemon.port);
    expect(run.out).toEqual([
      "no personas",
      "left out of /w/api/.flightdeck/personas: broken.md: no body",
    ]);
  });

  test("show asks the daemon to resolve the id and prints the persona", async () => {
    const daemon = fakeDaemon(HANDLERS);
    const run = await flightdeckd(
      ["persona", "show", "architect", "--language", "en", "--project-path", "/w/api"],
      daemon.port,
    );
    expect(run.code).toBe(0);
    expect(run.out).toEqual([
      "architect  Persona architect  (pack)",
      "does architect",
      "model: opus",
      "effort: high",
      "tools: Read, Grep",
      "permission mode: plan",
      "",
      "You are the architect.",
      "Keep modules deep.",
    ]);
    expect(asked(daemon)).toEqual([
      {
        type: "personas.resolve",
        payload: { ref: { id: "architect", language: "en" }, projectPath: "/w/api" },
      },
    ]);
  });

  test("show --json prints the daemon's answer", async () => {
    const run = await flightdeckd(
      ["persona", "show", "architect", "--json"],
      fakeDaemon(HANDLERS).port,
    );
    expect(run.out).toHaveLength(1);
    const answer = JSON.parse(run.out.join("\n")) as { source: string; persona: { id: string } };
    expect(answer.source).toBe("pack");
    expect(answer.persona.id).toBe("architect");
  });

  test("show of an id the daemon does not know exits 1 with the daemon's reason", async () => {
    const run = await flightdeckd(["persona", "show", "nope"], fakeDaemon(HANDLERS).port);
    expect(run.code).toBe(1);
    expect(run.out).toEqual([]);
    expect(run.err.join("\n")).toContain("no persona nope");
  });

  test("subagents prints the agents a project gets and the versioned personas left out for lack of trust", async () => {
    const daemon = fakeDaemon(HANDLERS);
    const run = await flightdeckd(
      ["persona", "subagents", "--project-path", "/w/api"],
      daemon.port,
    );
    expect(run.out).toEqual(["persona-architect  does architect", "not trusted, left out: local"]);
    expect(asked(daemon)).toEqual([
      { type: "personas.subagents", payload: { projectPath: "/w/api" } },
    ]);
    const json = await flightdeckd(["persona", "subagents", "--json"], daemon.port);
    expect(json.out).toHaveLength(1);
    expect(Object.keys(JSON.parse(json.out.join("\n")).agents)).toEqual(["persona-architect"]);
  });

  test("a verb of this slice changes nothing: only reads reach the daemon", async () => {
    const daemon = fakeDaemon(HANDLERS);
    await flightdeckd(["persona", "list"], daemon.port);
    await flightdeckd(["persona", "show", "architect"], daemon.port);
    await flightdeckd(["persona", "subagents"], daemon.port);
    expect(asked(daemon).map((call) => call.type)).toEqual([
      "personas.list",
      "personas.resolve",
      "personas.subagents",
    ]);
  });

  test("no daemon: exit 2 with one line saying so", async () => {
    const dead = fakeDaemon({});
    const port = dead.port;
    await stopAll();
    const run = await flightdeckd(["persona", "list"], port);
    expect(run.code).toBe(2);
    expect(run.err).toHaveLength(1);
    expect(run.err[0]).toMatch(/no daemon|could not reach/);
  });
});
