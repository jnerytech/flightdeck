import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { parseArgs } from "../../src/main.ts";
import { CLOSE, fakeDaemon, type Handlers, stopAll } from "../board/card-cli-helpers.ts";
import { flightdeckd } from "../support/cli-run.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const SUMMARIZE = {
  id: "summarize",
  title: { en: "Summarize a folder", "pt-BR": "Resumir uma pasta" },
  description: { en: "Reads a folder.", "pt-BR": "Lê uma pasta." },
  icon: "file",
  fields: [
    { id: "folder", kind: "folder", label: { en: "Folder", "pt-BR": "Pasta" } },
    {
      id: "tone",
      kind: "choice",
      optional: true,
      label: { en: "Tone", "pt-BR": "Tom" },
      choices: [
        { id: "formal", label: { en: "Formal", "pt-BR": "Formal" } },
        { id: "casual", label: { en: "Casual", "pt-BR": "Casual" } },
      ],
    },
  ],
  prompt: { en: "Summarize {folder}", "pt-BR": "Resuma {folder}" },
  preset: "read_only",
  planFirst: false,
};
const STARTED = {
  sessionId: "s9",
  workingFolder: "/w/docs",
  outputFolder: "/w/docs/Flightdeck results",
  permissionMode: "plan",
};
const FILES = {
  files: [
    {
      path: "/w/docs/Flightdeck results/summary.md",
      name: "summary.md",
      sizeBytes: 1234,
      modifiedAt: "2026-11-21T10:00:00.000Z",
      change: "new",
    },
    {
      path: "/w/docs/notes.txt",
      name: "notes.txt",
      sizeBytes: 12,
      modifiedAt: "2026-11-21T09:00:00.000Z",
      change: "changed",
    },
  ],
  truncated: false,
};

const OPEN: Handlers = {
  "session.list": () => ({ sessions: [{ id: "s9", name: "docs-task" }] }),
  "template.list": () => ({
    templates: [SUMMARIZE],
    problems: [{ file: "broken.json", reason: "not json" }],
  }),
  "template.start": () => STARTED,
  "task.results": () => FILES,
  "task.preview": () => ({ text: "# Summary\nline two\n", truncated: false }),
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

describe("the template and task arguments (issue #3738)", () => {
  test("template list takes nothing, and start takes a template id, its fields, the language and a name", () => {
    expect(parsed(["template", "list"])).toMatchObject({ command: "template", action: "list" });
    expect(parsed(["template", "list", "extra"])).toHaveProperty("refusal");
    expect(
      parsed([
        "template",
        "start",
        "summarize",
        "--field",
        "folder=/w/docs",
        "--field",
        "tone=a=b",
        "--language",
        "pt-BR",
        "--name",
        "My task",
        "--host",
        "pi",
        "--json",
      ]),
    ).toMatchObject({
      command: "template",
      action: "start",
      templateWords: ["summarize"],
      templateFields: ["folder=/w/docs", "tone=a=b"],
      language: "pt-BR",
      personaName: "My task",
      host: "pi",
      json: true,
    });
    expect(parsed(["template", "start", "summarize"])).toMatchObject({ action: "start" });
  });

  test("template start refuses a missing id, a field with no =, a repeated field id and a bad language", () => {
    expect(parsed(["template", "start"])).toHaveProperty("refusal");
    expect(parsed(["template", "start", "--field", "a=b"])).toHaveProperty("refusal");
    expect(parsed(["template", "start", "summarize", "--field", "folder"])).toHaveProperty(
      "refusal",
      expect.stringContaining("--field"),
    );
    expect(parsed(["template", "start", "summarize", "--field", "=x"])).toHaveProperty("refusal");
    expect(
      parsed(["template", "start", "summarize", "--field", "a=1", "--field", "a=2"]),
    ).toHaveProperty("refusal", expect.stringContaining("--field"));
    expect(parsed(["template", "start", "summarize", "--language", "fr"])).toHaveProperty(
      "refusal",
    );
    expect(parsed(["template", "start", "Bad_Id"])).toHaveProperty("refusal");
    expect(parsed(["template", "nope"])).toHaveProperty("refusal");
    expect(parsed(["template"])).toHaveProperty("refusal");
  });

  test("the start flags belong to template start alone", () => {
    expect(parsed(["template", "list", "--field", "a=b"])).toHaveProperty(
      "refusal",
      expect.stringContaining("--field"),
    );
    expect(parsed(["template", "list", "--name", "x"])).toHaveProperty("refusal");
    expect(parsed(["task", "results", "s1", "--field", "a=b"])).toHaveProperty("refusal");
    expect(parsed(["send", "s1", "hi", "--field", "a=b"])).toHaveProperty("refusal");
  });

  test("a task name is 1 to 100 characters", () => {
    expect(
      parsed(["template", "start", "summarize", "--name", "x".repeat(100)]),
    ).not.toHaveProperty("refusal");
    expect(parsed(["template", "start", "summarize", "--name", "x".repeat(101)])).toHaveProperty(
      "refusal",
      expect.stringContaining("--name"),
    );
    expect(parsed(["template", "start", "summarize", "--name", ""])).toHaveProperty("refusal");
  });

  test("task results takes a session, and preview a session and a path", () => {
    expect(parsed(["task", "results", "docs-task", "--json"])).toMatchObject({
      command: "task",
      action: "results",
      taskWords: ["docs-task"],
      json: true,
    });
    expect(parsed(["task", "preview", "docs-task", "/w/docs/notes.txt"])).toMatchObject({
      command: "task",
      action: "preview",
      taskWords: ["docs-task", "/w/docs/notes.txt"],
    });
    for (const line of [
      ["task"],
      ["task", "nope"],
      ["task", "results"],
      ["task", "results", "s1", "extra"],
      ["task", "preview", "s1"],
      ["task", "preview", "s1", "p", "extra"],
    ]) {
      expect(parsed(line)).toHaveProperty("refusal");
    }
  });
});

describe("flightdeckd template list (issue #3738)", () => {
  test("it prints a template, then a line per field, then the files that did not load", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["template", "list"], daemon.port);
    expect({ code: run.code, err: run.err }).toEqual({ code: 0, err: [] });
    expect(run.out).toEqual([
      "summarize  Summarize a folder  read_only",
      "  field folder  folder",
      "  field tone  choice  formal, casual  (optional)",
      "problem  broken.json  not json",
    ]);
  });

  test("--json prints the whole answer as one value", async () => {
    const run = await flightdeckd(["template", "list", "--json"], fakeDaemon(OPEN).port);
    expect(run.out).toHaveLength(1);
    expect(JSON.parse(run.out.join("\n"))).toEqual({
      templates: [SUMMARIZE],
      problems: [{ file: "broken.json", reason: "not json" }],
    });
  });

  test("text from the daemon cannot drive the terminal", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "template.list": () => ({
        templates: [{ ...SUMMARIZE, title: { en: "Bad\u001b[2Jtitle", "pt-BR": "x" } }],
        problems: [],
      }),
    });
    const run = await flightdeckd(["template", "list"], daemon.port);
    expect(run.out.join("\n")).not.toContain("\u001b");
  });
});

describe("flightdeckd template start (issue #3738)", () => {
  test("it sends the template, the language, the values and the name, and prints the session it started", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(
      [
        "template",
        "start",
        "summarize",
        "--field",
        "folder=/w/docs",
        "--field",
        "tone=formal",
        "--name",
        "Docs summary",
      ],
      daemon.port,
    );
    expect({ code: run.code, err: run.err }).toEqual({ code: 0, err: [] });
    expect(run.out).toEqual([
      "started  s9  plan  working /w/docs  results /w/docs/Flightdeck results",
    ]);
    expect(sent(daemon, "template.start")).toEqual([
      {
        templateId: "summarize",
        language: "en",
        values: { folder: "/w/docs", tone: "formal" },
        name: "Docs summary",
      },
    ]);
  });

  test("a folder or file field given as a relative path is refused before anything starts, since the daemon has another folder", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(
      ["template", "start", "summarize", "--field", "folder=./docs", "--field", "tone=formal"],
      daemon.port,
    );
    expect([run.code, run.err.join("\n")]).toEqual([
      1,
      expect.stringContaining("folder: give an absolute path"),
    ]);
    expect(sent(daemon, "template.start")).toEqual([]);
  });

  test("a relative path in a field that is not a path is sent as it is", async () => {
    const daemon = fakeDaemon(OPEN);
    await flightdeckd(
      ["template", "start", "summarize", "--field", "folder=/w/docs", "--field", "tone=./x"],
      daemon.port,
    );
    expect(sent(daemon, "template.start")).toHaveLength(1);
  });

  test("the language defaults to en and --language pt-BR is sent; no name is not sent", async () => {
    const daemon = fakeDaemon(OPEN);
    await flightdeckd(["template", "start", "summarize", "--language", "pt-BR"], daemon.port);
    expect(sent(daemon, "template.start")).toEqual([
      { templateId: "summarize", language: "pt-BR", values: {} },
    ]);
  });

  test("--json prints the started task with every key", async () => {
    const run = await flightdeckd(
      ["template", "start", "summarize", "--json"],
      fakeDaemon(OPEN).port,
    );
    expect(JSON.parse(run.out.join("\n"))).toEqual(STARTED);
  });

  test("an unknown template or a missing field is a refusal with the daemon's text, exit 1", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "template.start": () => ({
        error: { code: "not_found", message: "there is no template nope" },
      }),
    });
    const run = await flightdeckd(["template", "start", "nope"], daemon.port);
    expect([run.code, run.out, run.err.join("\n")]).toEqual([
      1,
      [],
      expect.stringContaining("there is no template nope"),
    ]);
  });

  test("a connection lost while the task starts says it may or may not have started", async () => {
    const daemon = fakeDaemon({ ...OPEN, "template.start": () => CLOSE });
    const run = await flightdeckd(["template", "start", "summarize"], daemon.port);
    expect([run.code, run.err.join("\n").includes("may or may not")]).toEqual([2, true]);
  });
});

describe("flightdeckd task results and preview (issue #3738)", () => {
  test("results asks for the session by name and prints a line per file", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["task", "results", "docs-task"], daemon.port);
    expect({ code: run.code, err: run.err }).toEqual({ code: 0, err: [] });
    expect(run.out).toEqual([
      "new  1234 B  2026-11-21T10:00:00.000Z  /w/docs/Flightdeck results/summary.md",
      "changed  12 B  2026-11-21T09:00:00.000Z  /w/docs/notes.txt",
    ]);
    expect(sent(daemon, "task.results")).toEqual([{ sessionId: "s9" }]);
  });

  test("a list cut short says so on stderr, and an empty one says there is nothing yet", async () => {
    const cut = fakeDaemon({ ...OPEN, "task.results": () => ({ ...FILES, truncated: true }) });
    const run = await flightdeckd(["task", "results", "s9"], cut.port);
    expect(run.code).toBe(0);
    expect(run.out).toHaveLength(2);
    expect(run.err.join("\n")).toContain("cut short");
    const none = fakeDaemon({ ...OPEN, "task.results": () => ({ files: [], truncated: false }) });
    const empty = await flightdeckd(["task", "results", "s9"], none.port);
    expect(empty.out).toEqual(["no files yet"]);
  });

  test("results --json carries files and truncated", async () => {
    const run = await flightdeckd(["task", "results", "s9", "--json"], fakeDaemon(OPEN).port);
    expect(JSON.parse(run.out.join("\n"))).toEqual(FILES);
  });

  test("an unknown session is exit 1 and nothing is asked of the task", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["task", "results", "nobody"], daemon.port);
    expect([run.code, run.err.join("\n")]).toEqual([1, "flightdeckd: no such session: nobody"]);
    expect(sent(daemon, "task.results")).toEqual([]);
  });

  test("preview refuses a relative path before any connection", () => {
    expect(parsed(["task", "preview", "docs-task", "./notes.txt"])).toHaveProperty(
      "refusal",
      expect.stringContaining("absolute"),
    );
  });

  test("preview prints the text as it is, line by line, and sends the path whole", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(
      ["task", "preview", "docs-task", "/w/docs/my notes.txt"],
      daemon.port,
    );
    expect({ code: run.code, err: run.err }).toEqual({ code: 0, err: [] });
    expect(run.out).toEqual(["# Summary", "line two"]);
    expect(sent(daemon, "task.preview")).toEqual([
      { sessionId: "s9", path: "/w/docs/my notes.txt" },
    ]);
  });

  test("a preview cut short says so on stderr and keeps stdout to the text", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "task.preview": () => ({ text: "first\r\nsecond", truncated: true }),
    });
    const run = await flightdeckd(["task", "preview", "s9", "/w/a.txt"], daemon.port);
    expect(run.out).toEqual(["first", "second"]);
    expect(run.err.join("\n")).toContain("cut short");
  });

  test("a preview cannot drive the terminal, and --json carries text and truncated", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "task.preview": () => ({ text: "ok\u001b]0;pwned\u0007\nnext", truncated: false }),
    });
    const plain = await flightdeckd(["task", "preview", "s9", "/w/a.txt"], daemon.port);
    expect(plain.out.join("\n").includes("\u001b") || plain.out.join("\n").includes("\u0007")).toBe(
      false,
    );
    const data = await flightdeckd(["task", "preview", "s9", "/w/a.txt", "--json"], daemon.port);
    expect(Object.keys(JSON.parse(data.out.join("\n"))).sort()).toEqual(["text", "truncated"]);
  });

  test("a path the daemon refuses is exit 1 with its text", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "task.preview": () => ({
        error: { code: "invalid_state", message: "that file is not a result of the task" },
      }),
    });
    const run = await flightdeckd(["task", "preview", "s9", "/etc/passwd"], daemon.port);
    expect([run.code, run.err.join("\n")]).toEqual([
      1,
      expect.stringContaining("not a result of the task"),
    ]);
  });

  test("no daemon is exit 2", async () => {
    const daemon = fakeDaemon(OPEN);
    const { port } = daemon;
    await stopAll();
    expect((await flightdeckd(["template", "list"], port)).code).toBe(2);
    expect((await flightdeckd(["task", "results", "s9"], port)).code).toBe(2);
  });
});
