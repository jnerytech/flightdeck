import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { parseArgs } from "../../src/main.ts";
import { CLOSE, fakeDaemon, type Handlers, stopAll } from "../board/card-cli-helpers.ts";
import { flightdeckd } from "../support/cli-run.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const REVIEW = {
  id: "01JSNIP0000000000000000001",
  scope: "host",
  source: "daemon",
  projectPath: null,
  name: "review",
  type: "command",
  run: "git diff {{branch}}",
  text: null,
  vars: {},
  tags: [],
  fields: [],
  favorite: false,
  uses: 0,
  lastUsedAt: null,
  runnable: true,
};
const HASH = "0123456789abcdef0123456789abcdef";

const callsOf = (daemon: ReturnType<typeof fakeDaemon>, type: string) =>
  daemon.calls.filter((c) => c.type === type).map((c) => c.payload);

const writeDaemon = (): Handlers => ({
  "snippets.get": (payload) =>
    payload.name === "review" || payload.id === REVIEW.id
      ? REVIEW
      : { error: { code: "not_found", message: "no snippet named that" } },
  "snippets.save": (payload) => ({ ...REVIEW, ...payload, id: REVIEW.id }),
  "snippets.remove": () => ({}),
  "snippets.favorite": (payload) => ({ ...REVIEW, favorite: payload.favorite }),
  "snippets.trust": (payload) => ({
    path: `${payload.projectPath}/.flightdeck/snippets.yaml`,
    hash: payload.hash,
    trusted: true,
    errors: [],
  }),
  "snippets.importHistory": () => ({
    candidates: [],
    sources: [{ shell: "bash", found: true }],
    created: [REVIEW],
    skipped: [{ id: "abc", reason: "a secret" }],
  }),
  "snippets.use": () => ({ text: "git diff dev", terminal: null }),
});

describe("flightdeckd snippet save (issue #3615)", () => {
  test("a command is saved for the host with its tags, and the line says which snippet it is", async () => {
    const daemon = fakeDaemon(writeDaemon());
    const run = await flightdeckd(
      [
        "snippet",
        "save",
        "deploy",
        "--run",
        "git push",
        "--tag",
        "ops",
        "--tag",
        "git",
        "--confirm",
      ],
      daemon.port,
    );
    expect({ code: run.code, err: run.err, out: run.out }).toEqual({
      code: 0,
      err: [],
      out: [`saved deploy  command  ${REVIEW.id}`],
    });
    expect(callsOf(daemon, "snippets.save")).toEqual([
      {
        name: "deploy",
        type: "command",
        run: "git push",
        tags: ["ops", "git"],
        scope: "host",
        target: "daemon",
      },
    ]);
  });

  test("remove, favorite and use look the name up in the project folder they are given", () => {
    for (const argv of [
      ["snippet", "remove", "review", "--project-path", "/srv/app", "--confirm"],
      ["snippet", "favorite", "review", "--project-path", "/srv/app"],
      ["snippet", "use", "review", "--terminal", "t7", "--project-path", "/srv/app", "--confirm"],
    ])
      expect(parseArgs(argv)).toMatchObject({ projectPath: "/srv/app" });
  });

  test("a prompt takes --text, and a folder makes it the project's", async () => {
    const daemon = fakeDaemon(writeDaemon());
    const run = await flightdeckd(
      [
        "snippet",
        "save",
        "ask",
        "--text",
        "Explain {{file}}",
        "--project-path",
        "/srv/app",
        "--confirm",
      ],
      daemon.port,
    );
    expect(run.code).toBe(0);
    expect(callsOf(daemon, "snippets.save")).toEqual([
      {
        name: "ask",
        type: "prompt",
        text: "Explain {{file}}",
        scope: "project",
        target: "daemon",
        projectPath: "/srv/app",
      },
    ]);
  });

  test("--json prints the saved snippet", async () => {
    const daemon = fakeDaemon(writeDaemon());
    const run = await flightdeckd(
      ["snippet", "save", "deploy", "--run", "git push", "--confirm", "--json"],
      daemon.port,
    );
    expect(run.code).toBe(0);
    expect(JSON.parse(run.out.join("\n")).id).toBe(REVIEW.id);
  });

  test("without --confirm, or without exactly one of --run and --text, nothing reaches the daemon", async () => {
    const daemon = fakeDaemon(writeDaemon());
    const bare = await flightdeckd(["snippet", "save", "deploy", "--run", "git push"], daemon.port);
    const both = await flightdeckd(
      ["snippet", "save", "deploy", "--run", "a", "--text", "b", "--confirm"],
      daemon.port,
    );
    const none = await flightdeckd(["snippet", "save", "deploy", "--confirm"], daemon.port);
    expect([bare.code, both.code, none.code]).toEqual([1, 1, 1]);
    expect(bare.err.join("\n")).toContain("snippet save needs --confirm");
    expect(both.err.join("\n")).toContain("exactly one of --run and --text");
    expect(none.err.join("\n")).toContain("exactly one of --run and --text");
    expect(daemon.calls.filter((c) => c.type !== "hello")).toEqual([]);
  });

  test("a daemon that refuses a secret in it exits 1 with its words", async () => {
    const daemon = fakeDaemon({
      ...writeDaemon(),
      "snippets.save": () => ({ error: { code: "snippet_secret", message: "it holds a secret" } }),
    });
    const run = await flightdeckd(
      ["snippet", "save", "deploy", "--run", "echo sk-secret", "--confirm"],
      daemon.port,
    );
    expect({ code: run.code, out: run.out }).toEqual({ code: 1, out: [] });
    expect(run.err.join("\n")).toContain("it holds a secret");
  });

  test("no answer exits 2 and says the snippet may or may not have been saved", async () => {
    const daemon = fakeDaemon({ ...writeDaemon(), "snippets.save": () => CLOSE });
    const run = await flightdeckd(
      ["snippet", "save", "deploy", "--run", "git push", "--confirm"],
      daemon.port,
    );
    expect(run.code).toBe(2);
    expect(run.err.join("\n")).toContain("may or may not");
  });
});

describe("flightdeckd snippet remove and favorite (issue #3615)", () => {
  test("remove by name needs --confirm, then removes the snippet by its id", async () => {
    const daemon = fakeDaemon(writeDaemon());
    const bare = await flightdeckd(["snippet", "remove", "review"], daemon.port);
    expect(bare.code).toBe(1);
    expect(bare.err.join("\n")).toContain("snippet remove needs --confirm");
    expect(callsOf(daemon, "snippets.remove")).toEqual([]);
    const run = await flightdeckd(["snippet", "remove", "review", "--confirm"], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({ code: 0, out: ["removed review"] });
    expect(callsOf(daemon, "snippets.remove")).toEqual([{ id: REVIEW.id }]);
  });

  test("a name no snippet has exits 1 and removes nothing", async () => {
    const daemon = fakeDaemon(writeDaemon());
    const run = await flightdeckd(["snippet", "remove", "ghost", "--confirm"], daemon.port);
    expect(run.code).toBe(1);
    expect(run.err.join("\n")).toContain("no snippet named that");
    expect(callsOf(daemon, "snippets.remove")).toEqual([]);
  });

  test("favorite marks the snippet, and --off clears the mark, with no --confirm", async () => {
    const daemon = fakeDaemon(writeDaemon());
    const on = await flightdeckd(["snippet", "favorite", "review"], daemon.port);
    const off = await flightdeckd(["snippet", "favorite", "review", "--off"], daemon.port);
    expect({ on: on.out, off: off.out }).toEqual({
      on: ["review  favorite"],
      off: ["review  not a favorite"],
    });
    expect(callsOf(daemon, "snippets.favorite")).toEqual([
      { id: REVIEW.id, favorite: true },
      { id: REVIEW.id, favorite: false },
    ]);
  });

  test("no answer to a remove exits 2 and says the snippet may or may not be gone", async () => {
    const daemon = fakeDaemon({ ...writeDaemon(), "snippets.remove": () => CLOSE });
    const run = await flightdeckd(["snippet", "remove", "review", "--confirm"], daemon.port);
    expect(run.code).toBe(2);
    expect(run.err.join("\n")).toContain("may or may not");
  });
});

describe("flightdeckd snippet trust (issue #3615)", () => {
  test("trust takes the folder and the hash snippet list showed, and needs --confirm", async () => {
    const daemon = fakeDaemon(writeDaemon());
    const bare = await flightdeckd(
      ["snippet", "trust", "--project-path", "/srv/app", "--hash", HASH],
      daemon.port,
    );
    expect(bare.code).toBe(1);
    expect(bare.err.join("\n")).toContain("snippet trust needs --confirm");
    expect(callsOf(daemon, "snippets.trust")).toEqual([]);
    const run = await flightdeckd(
      ["snippet", "trust", "--project-path", "/srv/app", "--hash", HASH, "--confirm"],
      daemon.port,
    );
    expect({ code: run.code, out: run.out }).toEqual({
      code: 0,
      out: [`trusted /srv/app/.flightdeck/snippets.yaml  ${HASH}`],
    });
    expect(callsOf(daemon, "snippets.trust")).toEqual([{ projectPath: "/srv/app", hash: HASH }]);
  });

  test("without the folder or the hash it is refused before the daemon is asked", async () => {
    const daemon = fakeDaemon(writeDaemon());
    const noHash = await flightdeckd(
      ["snippet", "trust", "--project-path", "/srv/app", "--confirm"],
      daemon.port,
    );
    const noFolder = await flightdeckd(
      ["snippet", "trust", "--hash", HASH, "--confirm"],
      daemon.port,
    );
    expect([noHash.code, noFolder.code]).toEqual([1, 1]);
    expect(noHash.err.join("\n")).toContain("snippet trust needs --hash");
    expect(noFolder.err.join("\n")).toContain("snippet trust needs --project-path");
    expect(daemon.calls.filter((c) => c.type !== "hello")).toEqual([]);
  });
});

describe("flightdeckd snippet import-history --select (issue #3615)", () => {
  test("the chosen candidates become snippets, and the lines say what was made and what was left", async () => {
    const daemon = fakeDaemon(writeDaemon());
    const run = await flightdeckd(
      ["snippet", "import-history", "--select", "abc,def", "--confirm"],
      daemon.port,
    );
    expect({ code: run.code, err: run.err, out: run.out }).toEqual({
      code: 0,
      err: [],
      out: ["imported review  command", "skipped abc  a secret"],
    });
    expect(callsOf(daemon, "snippets.importHistory")).toEqual([{ select: ["abc", "def"] }]);
  });

  test("--select needs --confirm, and without --select the verb still only reads", async () => {
    const daemon = fakeDaemon(writeDaemon());
    const bare = await flightdeckd(["snippet", "import-history", "--select", "abc"], daemon.port);
    expect(bare.code).toBe(1);
    expect(callsOf(daemon, "snippets.importHistory")).toEqual([]);
    const stray = await flightdeckd(["snippet", "import-history", "--confirm"], daemon.port);
    expect(stray.code).toBe(1);
    expect(stray.err.join("\n")).toContain(
      "--confirm: this flag only applies to flightdeckd snippet",
    );
    expect(bare.err.join("\n")).toContain("snippet import-history --select needs --confirm");
  });

  test("more than 200 candidates are refused", async () => {
    const many = Array.from({ length: 201 }, (_, i) => `c${i}`).join(",");
    expect(() => parseArgs(["snippet", "import-history", "--select", many, "--confirm"])).toThrow(
      "at most 200",
    );
  });

  test("no answer exits 2 and says some snippets may or may not have been made", async () => {
    const daemon = fakeDaemon({ ...writeDaemon(), "snippets.importHistory": () => CLOSE });
    const run = await flightdeckd(
      ["snippet", "import-history", "--select", "abc", "--confirm"],
      daemon.port,
    );
    expect(run.code).toBe(2);
    expect(run.err.join("\n")).toContain("may or may not");
  });
});

describe("flightdeckd snippet use (issue #3615)", () => {
  test("a command is typed into the terminal named, and the line says what went in", async () => {
    const daemon = fakeDaemon(writeDaemon());
    const run = await flightdeckd(
      ["snippet", "use", "review", "--terminal", "t7", "--value", "branch=dev", "--confirm"],
      daemon.port,
    );
    expect({ code: run.code, err: run.err, out: run.out }).toEqual({
      code: 0,
      err: [],
      out: ["typed into t7  git diff dev"],
    });
    expect(callsOf(daemon, "snippets.use")).toEqual([
      { id: REVIEW.id, action: "paste", terminalId: "t7", values: { branch: "dev" } },
    ]);
  });

  test("--enter also presses Enter, and the line says it ran", async () => {
    const daemon = fakeDaemon(writeDaemon());
    const run = await flightdeckd(
      ["snippet", "use", "review", "--terminal", "t7", "--enter", "--confirm"],
      daemon.port,
    );
    expect(run.out).toEqual(["ran in t7  git diff dev"]);
    expect(callsOf(daemon, "snippets.use")).toEqual([
      { id: REVIEW.id, action: "paste", terminalId: "t7", enter: true },
    ]);
  });

  test("without --confirm or --terminal nothing is asked of the daemon", async () => {
    const daemon = fakeDaemon(writeDaemon());
    const bare = await flightdeckd(["snippet", "use", "review", "--terminal", "t7"], daemon.port);
    const noTerminal = await flightdeckd(["snippet", "use", "review", "--confirm"], daemon.port);
    expect([bare.code, noTerminal.code]).toEqual([1, 1]);
    expect(bare.err.join("\n")).toContain("snippet use needs --confirm");
    expect(noTerminal.err.join("\n")).toContain("snippet use needs --terminal");
    expect(daemon.calls.filter((c) => c.type !== "hello")).toEqual([]);
  });

  test("a host with a device enrolled wants that device's signature on a trust: says the person does it in the app, exit 1", async () => {
    const daemon = fakeDaemon({
      ...writeDaemon(),
      "snippets.trust": () => ({
        error: {
          code: "invalid_state",
          message: "the request needs the signature of an enrolled device",
          reason: "approval_proof_required",
        },
      }),
    });
    const run = await flightdeckd(
      ["snippet", "trust", "--project-path", "/srv/app", "--hash", HASH, "--confirm"],
      daemon.port,
    );
    expect({ code: run.code, out: run.out }).toEqual({ code: 1, out: [] });
    expect(run.err.join("\n")).toContain("do it in the app");
    expect(run.err.join("\n")).not.toContain("signature of an enrolled device");
  });

  test("a project file the person has not trusted is refused by the daemon, exit 1", async () => {
    const daemon = fakeDaemon({
      ...writeDaemon(),
      "snippets.use": () => ({
        error: { code: "snippet_untrusted", message: "trust the project's file first" },
      }),
    });
    const run = await flightdeckd(
      ["snippet", "use", "review", "--terminal", "t7", "--enter", "--confirm"],
      daemon.port,
    );
    expect({ code: run.code, out: run.out }).toEqual({ code: 1, out: [] });
    expect(run.err.join("\n")).toContain("trust the project's file first");
  });

  test("no answer exits 2 and says the text may or may not have gone into the terminal", async () => {
    const daemon = fakeDaemon({ ...writeDaemon(), "snippets.use": () => CLOSE });
    const run = await flightdeckd(
      ["snippet", "use", "review", "--terminal", "t7", "--confirm"],
      daemon.port,
    );
    expect(run.code).toBe(2);
    expect(run.err.join("\n")).toContain("may or may not");
  });
});

describe("the write verbs' flags (issue #3615)", () => {
  test("each flag belongs to its verbs", () => {
    expect(parseArgs(["snippet", "favorite", "review", "--off"])).toMatchObject({
      command: "snippet",
      action: "favorite",
    });
    for (const argv of [
      ["snippet", "list", "--run", "x"],
      ["snippet", "render", "review", "--terminal", "t7"],
      ["snippet", "save", "a", "--run", "x", "--enter"],
      ["snippet", "get", "review", "--confirm"],
      ["snippet", "render", "review", "--confirm"],
      ["snippet", "remove", "review", "--confirm", "--off"],
      ["snippet", "use", "review", "--terminal", "t", "--text", "x"],
    ])
      expect(() => parseArgs(argv)).toThrow("this flag only applies to");
  });
});

describe("flightdeckd snippet writes by name: what the code review found (issue #3615)", () => {
  test("a name a host snippet and a project snippet share is refused, and nothing is changed", async () => {
    const project = { ...REVIEW, id: "01JSNIP0000000000000000002", scope: "project" };
    const daemon = fakeDaemon({
      ...writeDaemon(),
      "snippets.list": () => ({ snippets: [REVIEW, project], file: null }),
    });
    const run = await flightdeckd(
      ["snippet", "remove", "review", "--project-path", "/srv/app", "--confirm"],
      daemon.port,
    );
    expect(run.code).toBe(1);
    expect(run.err.join("\n")).toContain(
      `review names 2 snippets (${REVIEW.id}, ${project.id}): give one of the ids`,
    );
    expect(callsOf(daemon, "snippets.remove")).toEqual([]);
  });

  test("a name only one snippet has is removed as before, by its id", async () => {
    const daemon = fakeDaemon({
      ...writeDaemon(),
      "snippets.list": () => ({ snippets: [REVIEW], file: null }),
    });
    const run = await flightdeckd(
      ["snippet", "remove", "review", "--project-path", "/srv/app", "--confirm"],
      daemon.port,
    );
    expect(run.code).toBe(0);
    expect(callsOf(daemon, "snippets.remove")).toEqual([{ id: REVIEW.id }]);
  });

  test("a snippet of several lines prints one stdout line per line of its text", async () => {
    const daemon = fakeDaemon({
      ...writeDaemon(),
      "snippets.use": () => ({ text: "git diff\ngit log", terminal: null }),
    });
    const run = await flightdeckd(
      ["snippet", "use", "review", "--terminal", "t7", "--confirm"],
      daemon.port,
    );
    expect(run.out).toEqual(["typed into t7  git diff", "git log"]);
  });

  test("--select needs an id, and the flags that only preview do not come with it", () => {
    for (const [argv, why] of [
      [
        ["snippet", "import-history", "--select", ",", "--confirm"],
        "--select needs at least one id",
      ],
      [
        ["snippet", "import-history", "--select", "a", "--limit", "5", "--confirm"],
        "--limit: this flag does not apply with --select",
      ],
      [
        ["snippet", "import-history", "--select", "a", "--reveal", "--confirm"],
        "--reveal: this flag does not apply with --select",
      ],
    ] as const)
      expect(() => parseArgs([...argv])).toThrow(why);
  });
});
