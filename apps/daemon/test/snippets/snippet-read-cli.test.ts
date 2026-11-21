import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "../../src/main.ts";
import { CLOSE, fakeDaemon, type Handlers, stopAll } from "../board/card-cli-helpers.ts";
import { flightdeckd } from "../support/cli-run.ts";
import { tempDir } from "../support/helpers.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const REVIEW = {
  id: "01JSNIP0000000000000000001",
  scope: "host",
  source: "daemon",
  projectPath: null,
  name: "review",
  type: "prompt",
  run: null,
  text: "Review {{file}} on {{branch}}",
  vars: {},
  tags: [],
  fields: [],
  favorite: false,
  uses: 0,
  lastUsedAt: null,
  runnable: true,
};
const FIELDS = [
  { name: "file", special: true, default: null, options: [] },
  { name: "branch", special: false, default: "main", options: ["main", "dev"] },
];

const callsOf = (daemon: ReturnType<typeof fakeDaemon>, type: string) =>
  daemon.calls.filter((c) => c.type === type).map((c) => c.payload);

const renderDaemon = (): Handlers => ({
  "snippets.get": (payload) =>
    payload.name === "review" || payload.id === REVIEW.id
      ? REVIEW
      : { error: { code: "not_found", message: "snippet not found" } },
  "snippets.render": (payload) => ({
    text: `Review a.ts on ${(payload.values as Record<string, string>).branch}`,
    fields: FIELDS,
  }),
});

describe("flightdeckd snippet render (issue #3615)", () => {
  test("it names the snippet by its name, sends the values and prints only the text", async () => {
    const daemon = fakeDaemon(renderDaemon());
    const run = await flightdeckd(
      ["snippet", "render", "review", "--value", "file=a.ts", "--value", "branch=dev"],
      daemon.port,
    );
    expect({ code: run.code, err: run.err }).toEqual({ code: 0, err: [] });
    expect(run.out).toEqual(["Review a.ts on dev"]);
    expect(callsOf(daemon, "snippets.get")).toEqual([{ name: "review" }]);
    expect(callsOf(daemon, "snippets.render")).toEqual([
      { id: REVIEW.id, values: { file: "a.ts", branch: "dev" } },
    ]);
  });

  test("--json prints the text and the fields it asks for, and --project-path scopes the name", async () => {
    const daemon = fakeDaemon(renderDaemon());
    const run = await flightdeckd(
      [
        "snippet",
        "render",
        "review",
        "--value",
        "branch=main",
        "--project-path",
        "/srv/app",
        "--json",
      ],
      daemon.port,
    );
    expect(run.code).toBe(0);
    expect(JSON.parse(run.out.join("\n"))).toEqual({
      id: REVIEW.id,
      name: "review",
      text: "Review a.ts on main",
      fields: FIELDS,
    });
    expect(callsOf(daemon, "snippets.get")).toEqual([{ name: "review", projectPath: "/srv/app" }]);
  });

  test("a word that is no name is tried as an id, and nothing is sent without values it was not given", async () => {
    const daemon = fakeDaemon(renderDaemon());
    const run = await flightdeckd(
      ["snippet", "render", REVIEW.id, "--value", "branch=main"],
      daemon.port,
    );
    expect(run.code).toBe(0);
    expect(callsOf(daemon, "snippets.get")).toEqual([{ name: REVIEW.id }, { id: REVIEW.id }]);
    const bare = fakeDaemon(renderDaemon());
    await flightdeckd(["snippet", "render", "review"], bare.port);
    expect(callsOf(bare, "snippets.render")).toEqual([{ id: REVIEW.id }]);
  });

  test("an unknown snippet exits 1 with the daemon's text and renders nothing", async () => {
    const daemon = fakeDaemon(renderDaemon());
    const run = await flightdeckd(["snippet", "render", "nope"], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({ code: 1, out: [] });
    expect(run.err.join("\n")).toContain("snippet not found");
    expect(callsOf(daemon, "snippets.render")).toEqual([]);
  });

  test("a field left empty is the daemon's refusal: one line on stderr, exit 1", async () => {
    const daemon = fakeDaemon({
      ...renderDaemon(),
      "snippets.render": () => ({
        error: { code: "bad_request", message: "the field file has no value" },
      }),
    });
    const run = await flightdeckd(["snippet", "render", "review"], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({ code: 1, out: [] });
    expect(run.err.join("\n")).toContain("the field file has no value");
  });

  test("a text that carries terminal controls is printed without them, in the text and in --json", async () => {
    const daemon = fakeDaemon({
      ...renderDaemon(),
      "snippets.render": () => ({ text: "ok\u001b[2Jgone", fields: [] }),
    });
    const text = await flightdeckd(["snippet", "render", "review"], daemon.port);
    expect(text.out.join("\n")).toBe("ok [2Jgone");
    const asJson = await flightdeckd(["snippet", "render", "review", "--json"], daemon.port);
    expect(asJson.out.join("\n")).not.toContain("\u001b");
  });
});

describe("flightdeckd snippet parse (issue #3615)", () => {
  const PARSED = {
    snippets: [
      { name: "status", type: "command", run: "git status", vars: {}, tags: ["git"] },
      { name: "ask", type: "prompt", text: "Why {{file}}?", vars: {}, tags: [] },
    ],
    errors: [],
  };
  const file = (text: string) => {
    const path = join(tempDir("fd-snippet-parse-"), "snippets.yaml");
    writeFileSync(path, text);
    return path;
  };
  const stream = (text: string) =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(text));
        controller.close();
      },
    });

  test("it sends the file's text, prints one line per snippet it read and saves none", async () => {
    const daemon = fakeDaemon({ "snippets.parse": () => PARSED });
    const path = file("- name: status\n  type: command\n  run: git status\n");
    const run = await flightdeckd(["snippet", "parse", path], daemon.port);
    expect({ code: run.code, err: run.err }).toEqual({ code: 0, err: [] });
    expect(run.out).toEqual(["status  command  tags: git", "ask  prompt"]);
    expect(callsOf(daemon, "snippets.parse")).toEqual([
      { text: "- name: status\n  type: command\n  run: git status\n" },
    ]);
    expect(daemon.calls.map((c) => c.type)).not.toContain("snippets.save");
  });

  test("a - reads the text from stdin, and --json prints what the daemon read", async () => {
    const daemon = fakeDaemon({ "snippets.parse": () => PARSED });
    const run = await flightdeckd(["snippet", "parse", "-", "--json"], daemon.port, undefined, {
      stdin: stream("[]"),
    });
    expect(run.code).toBe(0);
    expect(JSON.parse(run.out.join("\n"))).toEqual(PARSED);
    expect(callsOf(daemon, "snippets.parse")).toEqual([{ text: "[]" }]);
  });

  test("a file that is neither YAML nor JSON exits 1 with the reasons on stderr", async () => {
    const daemon = fakeDaemon({
      "snippets.parse": () => ({ snippets: [], errors: ["not a YAML or JSON list"] }),
    });
    const run = await flightdeckd(["snippet", "parse", file(": : :")], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({ code: 1, out: [] });
    expect(run.err.join("\n")).toContain("not a YAML or JSON list");
  });

  test("a file with some entries left out prints the rest, says why on stderr and exits 0", async () => {
    const daemon = fakeDaemon({
      "snippets.parse": () => ({ ...PARSED, errors: ["entry 3: the name is missing"] }),
    });
    const run = await flightdeckd(["snippet", "parse", file("x")], daemon.port);
    expect(run.code).toBe(0);
    expect(run.out).toHaveLength(2);
    expect(run.err.join("\n")).toContain("entry 3: the name is missing");
  });

  test("a file that cannot be read exits 1 and never reaches the daemon", async () => {
    const daemon = fakeDaemon({ "snippets.parse": () => PARSED });
    const run = await flightdeckd(["snippet", "parse", "/no/such/snippets.yaml"], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({ code: 1, out: [] });
    expect(run.err.join("\n")).toContain("could not read /no/such/snippets.yaml");
    expect(callsOf(daemon, "snippets.parse")).toEqual([]);
  });

  test("a text over the protocol's limit is refused before it is sent", async () => {
    const daemon = fakeDaemon({ "snippets.parse": () => PARSED });
    const run = await flightdeckd(["snippet", "parse", "-"], daemon.port, undefined, {
      stdin: stream("x".repeat(1_000_001)),
    });
    expect({ code: run.code, out: run.out }).toEqual({ code: 1, out: [] });
    expect(run.err.join("\n")).toContain("at most 1000000 characters");
    expect(callsOf(daemon, "snippets.parse")).toEqual([]);
  });
});

describe("flightdeckd snippet import-history (issue #3615)", () => {
  const PREVIEW = {
    candidates: [
      {
        id: "h1",
        command: "git status",
        count: 42,
        shells: ["bash", "zsh"],
        flagged: [],
        hidden: false,
        selectable: true,
      },
      {
        id: "h2",
        command: null,
        count: 3,
        shells: ["bash"],
        flagged: ["aws-access-key"],
        hidden: true,
        selectable: false,
      },
    ],
    sources: [
      { shell: "bash", found: true },
      { shell: "zsh", found: true },
    ],
    created: [],
    skipped: [],
  };

  test("it asks for no selection, prints a line per candidate and hides a flagged command", async () => {
    const daemon = fakeDaemon({ "snippets.importHistory": () => PREVIEW });
    const run = await flightdeckd(["snippet", "import-history"], daemon.port);
    expect({ code: run.code, err: run.err }).toEqual({ code: 0, err: [] });
    expect(run.out).toEqual([
      "h1  42x  bash,zsh  git status",
      "h2  3x  bash  hidden: aws-access-key",
    ]);
    expect(callsOf(daemon, "snippets.importHistory")).toEqual([{}]);
  });

  test("--limit and --reveal go through, and --json prints the result with null for a hidden command", async () => {
    const daemon = fakeDaemon({ "snippets.importHistory": () => PREVIEW });
    const run = await flightdeckd(
      ["snippet", "import-history", "--limit", "20", "--reveal", "--json"],
      daemon.port,
    );
    expect(run.code).toBe(0);
    expect(JSON.parse(run.out.join("\n"))).toEqual(PREVIEW);
    expect(callsOf(daemon, "snippets.importHistory")).toEqual([{ limit: 20, reveal: true }]);
  });

  test("with no history it says so, and --json prints an empty list", async () => {
    const none = {
      candidates: [],
      sources: [{ shell: "bash", found: false }],
      created: [],
      skipped: [],
    };
    const daemon = fakeDaemon({ "snippets.importHistory": () => none });
    const text = await flightdeckd(["snippet", "import-history"], daemon.port);
    expect({ code: text.code, out: text.out }).toEqual({
      code: 0,
      out: ["no shell history found"],
    });
    const asJson = await flightdeckd(["snippet", "import-history", "--json"], daemon.port);
    expect(JSON.parse(asJson.out.join("\n"))).toEqual(none);
  });
});

describe("the snippet read verbs, as the terminal runs them (issue #3615)", () => {
  test("a daemon that closes before it answers exits 2", async () => {
    const daemon = fakeDaemon({ "snippets.importHistory": () => CLOSE });
    const run = await flightdeckd(["snippet", "import-history"], daemon.port);
    expect(run.code).toBe(2);
    expect(run.err.join("\n")).not.toContain("may or may not");
  });

  test("no daemon at the address of the config: exit 2", async () => {
    const daemon = fakeDaemon({});
    const port = daemon.port;
    await stopAll();
    const run = await flightdeckd(["snippet", "render", "review"], port);
    expect(run.code).toBe(2);
    expect(run.err.join("\n")).toContain("could not reach the daemon");
  });
});

describe("the arguments of snippet (issue #3615)", () => {
  const parsed = (argv: string[]) => {
    try {
      return parseArgs(argv);
    } catch (error) {
      return { refusedWith: (error as Error).message };
    }
  };

  test("list and get keep their words and flags", () => {
    expect(parsed(["snippet", "list", "--query", "git"])).toMatchObject({
      command: "snippet",
      action: "list",
      query: "git",
    });
    expect(parsed(["snippet", "get", "review"])).toMatchObject({
      action: "get",
      snippetName: "review",
    });
  });

  test("render takes a name and values, parse a source, import-history a limit and --reveal", () => {
    expect(
      parsed([
        "snippet",
        "render",
        "review",
        "--value",
        "a=1",
        "--value",
        "b=x=y",
        "--json",
        "--host",
        "pi",
      ]),
    ).toMatchObject({
      action: "render",
      snippetName: "review",
      snippetValues: { a: "1", b: "x=y" },
      json: true,
      host: "pi",
    });
    expect(parsed(["snippet", "parse", "-"])).toMatchObject({ action: "parse", snippetFile: "-" });
    expect(parsed(["snippet", "import-history", "--limit", "200", "--reveal"])).toMatchObject({
      action: "import-history",
      limit: 200,
      snippetReveal: true,
    });
  });

  test("a missing operand, a stray word or an unknown verb is refused before anything is sent", () => {
    for (const [argv, why] of [
      [["snippet"], "invalid snippet action"],
      [["snippet", "bogus"], "invalid snippet action"],
      [["snippet", "render"], "missing the snippet name"],
      [["snippet", "parse"], "missing the file"],
      [["snippet", "import-history", "extra"], "unknown argument: extra"],
      [["snippet", "render", "r", "--value", "novalue"], "--value needs name=value"],
    ] as const)
      expect(JSON.stringify(parsed([...argv]))).toContain(why);
  });

  test("each flag belongs to its verbs: --value to render, --reveal to import-history, --host not to list or get", () => {
    for (const [argv, why] of [
      [
        ["snippet", "get", "r", "--value", "a=1"],
        "--value: this flag only applies to flightdeckd snippet render",
      ],
      [
        ["snippet", "list", "--reveal"],
        "--reveal: this flag only applies to flightdeckd snippet import-history",
      ],
      [
        ["snippet", "list", "--host", "pi"],
        "--host: this flag only applies to flightdeckd snippet render",
      ],
      [
        ["snippet", "get", "r", "--json"],
        "--json: this flag only applies to flightdeckd snippet render",
      ],
      [["snippet", "import-history", "--limit", "201"], "--limit: at most 200"],
    ] as const)
      expect(JSON.stringify(parsed([...argv]))).toContain(why);
  });
});
