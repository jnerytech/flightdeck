import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { runCardCli } from "../../src/board/card-cli.ts";
import type { CardCliArgs } from "../../src/board/domain/card-cli-view.ts";
import type { CliResult } from "../../src/daemon-client/index.ts";
import { parseArgs } from "../../src/main.ts";
import {
  card,
  config,
  fakeDaemon,
  type Handlers,
  HOST,
  stopAll,
  stops,
} from "./card-cli-helpers.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const text = (r: CliResult) => [...r.out, ...r.err].join("\n");
/** The one JSON document a `--json` run printed: a run that printed nothing fails here, by assertion. */
function printed<T>(r: CliResult): T {
  expect(r.out).toHaveLength(1);
  return JSON.parse(r.out.join("\n")) as T;
}
const NO_CARD = { error: { code: "not_found", message: "no such card" } };

const file = (over: Record<string, unknown>) => ({
  path: "src/a.ts",
  oldPath: null,
  status: "modified",
  additions: 1,
  deletions: 1,
  uncommitted: false,
  binary: false,
  hunks: [
    {
      header: "@@ -1,2 +1,2 @@",
      lines: [
        { op: " ", text: "keep" },
        { op: "-", text: "old" },
        { op: "+", text: "new" },
      ],
    },
  ],
  ...over,
});

const HANDLERS: Handlers = {
  ...HOST,
  "card.diff": ({ cardId }) =>
    cardId === "nope"
      ? NO_CARD
      : cardId === "empty"
        ? { base: "main", files: [] }
        : {
            base: "main",
            files: [
              file({}),
              file({ path: "src/b.ts", oldPath: "src/old.ts", status: "renamed", hunks: [] }),
              file({ path: "img.png", binary: true, hunks: [] }),
              file({ path: ".env", secret: true, hunks: [] }),
              file({ path: "big.sql", tooLarge: true, bytes: 900000, hunks: [] }),
            ],
          },
  "card.spec": ({ cardId }) =>
    cardId === "nope"
      ? NO_CARD
      : cardId === "nospec"
        ? card("nospec")
        : cardId === "missing"
          ? card("missing", { specState: { path: "docs/x.md", found: false, heading: null } })
          : card(String(cardId), {
              specState: { path: "docs/a.md", found: true, heading: "Login", draft: true },
            }),
  "card.review": ({ cardId }) =>
    cardId === "nope"
      ? NO_CARD
      : cardId === "broken"
        ? {
            state: "failed",
            summary: "the reviewer did not answer",
            anchored: 0,
            loose: [],
            cached: false,
            moved: false,
          }
        : {
            state: "done",
            summary: "Two things to look at.",
            anchored: 1,
            loose: [{ path: "src/a.ts", line: 7, severity: "high", body: "No check\nhere." }],
            cached: true,
            moved: true,
          },
  "card.message": ({ cardId }) => (cardId === "nope" ? NO_CARD : { queued: cardId === "busy" }),
  "card.templates": ({ projectId }) =>
    projectId === "p2"
      ? { templates: [], dropped: 0, ignored: null }
      : {
          templates: [
            {
              id: "bug",
              name: "Bug report",
              description: "- [ ] repro",
              workflow: null,
              persona: null,
              pins: [],
              spec: null,
            },
          ],
          dropped: 2,
          ignored: null,
        },
  "card.validationTemplate": ({ cardId }) =>
    cardId === "nope"
      ? NO_CARD
      : cardId === "ignored"
        ? { text: null, ignored: "untrusted" }
        : cardId === "none"
          ? { text: null, ignored: null }
          : { text: "Steps:\n1. run it", ignored: null },
};

async function run(args: CardCliArgs, handlers: Handlers = HANDLERS, timeoutMs?: number) {
  const daemon = fakeDaemon(handlers);
  const result = await runCardCli(args, config(daemon.port), timeoutMs ? { timeoutMs } : {});
  return { result, calls: daemon.calls.filter((c) => c.type.startsWith("card.")) };
}

describe("card diff (issue #3454)", () => {
  test("prints the diff as text, one line each, naming what has no lines", async () => {
    const { result, calls } = await run({ action: "diff", id: "c1" });
    expect(result.code).toBe(0);
    expect(calls).toEqual([{ type: "card.diff", payload: { cardId: "c1" } }]);
    expect(result.out).toEqual([
      "diff against main",
      "--- src/a.ts (modified, +1 -1)",
      "@@ -1,2 +1,2 @@",
      " keep",
      "-old",
      "+new",
      "--- src/b.ts (renamed from src/old.ts, +1 -1)",
      "--- img.png (modified, binary)",
      "--- .env (modified, may hold a credential: not shown)",
      "--- big.sql (modified, too large: 900000 bytes, not shown)",
    ]);
  });

  test("a card with no changes says so, and --json holds the daemon's answer", async () => {
    const none = await run({ action: "diff", id: "empty" });
    expect(none.result.out).toEqual(["no changes against main"]);
    const { result } = await run({ action: "diff", id: "c1", json: true });
    const diff = printed<{ base: string; files: unknown[] }>(result);
    expect([diff.base, diff.files.length]).toEqual(["main", 5]);
  });

  test("an unknown card is exit 1 with the daemon's reason", async () => {
    const { result } = await run({ action: "diff", id: "nope" });
    expect(result.code).toBe(1);
    expect(text(result)).toContain("no such card");
  });
});

describe("card spec (issue #3454)", () => {
  test("says where the spec file is and what it holds", async () => {
    const { result, calls } = await run({ action: "spec", id: "c1" });
    expect(calls).toEqual([{ type: "card.spec", payload: { cardId: "c1" } }]);
    expect(result.out).toEqual(["c1  spec docs/a.md", "heading: Login", "draft: yes"]);
    expect((await run({ action: "spec", id: "missing" })).result.out).toEqual([
      "missing  spec docs/x.md: file not found",
    ]);
    expect((await run({ action: "spec", id: "nospec" })).result.out).toEqual([
      "nospec  has no spec file",
    ]);
  });

  test("--json prints the card, and an unknown card is exit 1", async () => {
    const { result } = await run({ action: "spec", id: "c1", json: true });
    expect(printed<{ id: string }>(result).id).toBe("c1");
    expect((await run({ action: "spec", id: "nope" })).result.code).toBe(1);
  });
});

describe("card review (issue #3454)", () => {
  test("sends the card, and the language only when given, and prints the findings", async () => {
    const plain = await run({ action: "review", id: "c1" });
    expect(plain.calls).toEqual([{ type: "card.review", payload: { cardId: "c1" } }]);
    expect(plain.result.code).toBe(0);
    expect(plain.result.out).toEqual([
      "review of c1: done (cached, the card was moved)",
      "Two things to look at.",
      "1 finding anchored to the diff as a review comment",
      "high  src/a.ts:7  No check here.",
    ]);
    const pt = await run({ action: "review", id: "c1", language: "pt-BR" });
    expect(pt.calls[0]?.payload).toEqual({ cardId: "c1", language: "pt-BR" });
  });

  test("a review that failed is exit 1 with its summary; --json holds the result", async () => {
    const failed = await run({ action: "review", id: "broken" });
    expect(failed.result.code).toBe(1);
    expect(text(failed.result)).toContain("the reviewer did not answer");
    const failedJson = await run({ action: "review", id: "broken", json: true });
    expect(failedJson.result.code).toBe(1);
    expect(printed<{ state: string }>(failedJson.result).state).toBe("failed");
    const { result } = await run({ action: "review", id: "c1", json: true });
    expect(printed<{ state: string }>(result).state).toBe("done");
  });

  test("an unknown card is exit 1, and a silent daemon leaves the result unknown", async () => {
    expect((await run({ action: "review", id: "nope" })).result.code).toBe(1);
    const silent = fakeDaemon({});
    const result = await runCardCli({ action: "review", id: "c1" }, config(silent.port), {
      timeoutMs: 200,
    });
    expect(result.code).toBe(2);
    expect(text(result)).toContain("may or may not have been");
    expect(stops.length).toBeGreaterThan(0);
  });
});

describe("card message (issue #3454)", () => {
  test("sends the text to the card's session and says whether it waits", async () => {
    const sent = await run({ action: "message", id: "c1", text: "please rebase" });
    expect(sent.calls).toEqual([
      { type: "card.message", payload: { cardId: "c1", text: "please rebase" } },
    ]);
    expect(sent.result.out).toEqual(["sent to c1"]);
    const queued = await run({ action: "message", id: "busy", text: "hi" });
    expect(queued.result.out).toEqual([
      "queued for busy: the session is working, it reads this after its turn",
    ]);
  });

  test("--json holds the daemon's answer; an empty text is refused before sending", async () => {
    const { result } = await run({ action: "message", id: "c1", text: "hi", json: true });
    expect(printed(result)).toEqual({ queued: false });
    const empty = await run({ action: "message", id: "c1", text: "" });
    expect(empty.result.code).toBe(1);
    expect(empty.calls).toEqual([]);
    expect((await run({ action: "message", id: "nope", text: "hi" })).result.code).toBe(1);
  });

  test("a silent daemon leaves the result unknown", async () => {
    const silent = fakeDaemon({});
    const result = await runCardCli(
      { action: "message", id: "c1", text: "hi" },
      config(silent.port),
      { timeoutMs: 200 },
    );
    expect(result.code).toBe(2);
    expect(text(result)).toContain("may or may not have been sent");
  });
});

describe("card templates (issue #3454)", () => {
  test("lists the templates of the project, and what the host left out", async () => {
    const { result, calls } = await run({ action: "templates", project: "api" });
    expect(calls).toEqual([{ type: "card.templates", payload: { projectId: "p1" } }]);
    expect(result.out).toEqual([
      "bug  Bug report",
      "2 entries of the templates file were left out",
    ]);
  });

  test("a project with none says so; several projects need --project", async () => {
    expect((await run({ action: "templates", project: "web" })).result.out).toEqual([
      "no card templates in web",
    ]);
    const several = await run({ action: "templates" });
    expect(several.result.code).toBe(1);
    expect(text(several.result)).toContain("--project");
    expect(several.calls).toEqual([]);
  });

  test("--json prints the daemon's answer", async () => {
    const { result } = await run({ action: "templates", project: "api", json: true });
    expect(printed<{ dropped: number }>(result).dropped).toBe(2);
  });
});

describe("card validation-template (issue #3454)", () => {
  test("prints the project's note shape, or why it was not used", async () => {
    const shown = await run({ action: "validation-template", id: "c1" });
    expect(shown.calls).toEqual([{ type: "card.validationTemplate", payload: { cardId: "c1" } }]);
    expect(shown.result.out).toEqual(["Steps:", "1. run it"]);
    expect((await run({ action: "validation-template", id: "ignored" })).result.out).toEqual([
      "the project's validation template was not used: untrusted",
    ]);
    expect((await run({ action: "validation-template", id: "none" })).result.out).toEqual([
      "the project has no validation template",
    ]);
  });

  test("--json holds the daemon's answer, and an unknown card is exit 1", async () => {
    const { result } = await run({ action: "validation-template", id: "c1", json: true });
    expect(printed<{ ignored: null }>(result).ignored).toBeNull();
    expect((await run({ action: "validation-template", id: "nope" })).result.code).toBe(1);
  });
});

describe("the arguments of the reading verbs (issue #3454)", () => {
  test("each verb takes what it reads", () => {
    expect(parseArgs(["card", "diff", "c1", "--json"])).toMatchObject({
      action: "diff",
      cardId: "c1",
      json: true,
    });
    expect(parseArgs(["card", "spec", "c1"])).toMatchObject({ action: "spec", cardId: "c1" });
    expect(parseArgs(["card", "review", "c1", "--language", "pt-BR"])).toMatchObject({
      action: "review",
      cardId: "c1",
      language: "pt-BR",
    });
    expect(parseArgs(["card", "message", "c1", "please rebase"])).toMatchObject({
      action: "message",
      cardId: "c1",
      text: "please rebase",
    });
    expect(parseArgs(["card", "templates", "--project", "api"])).toMatchObject({
      action: "templates",
      project: "api",
    });
    expect(parseArgs(["card", "validation-template", "c1"])).toMatchObject({
      action: "validation-template",
      cardId: "c1",
    });
    expect(() => parseArgs(["card", "message", "c1"])).toThrow("missing the text");
    expect(() => parseArgs(["card", "diff"])).toThrow("missing the card");
    expect(() => parseArgs(["card", "review", "c1", "--language", "fr"])).toThrow("--language");
  });

  test("--language belongs to review only", () => {
    expect(() => parseArgs(["card", "diff", "c1", "--language", "en"])).toThrow(
      "only applies to flightdeckd card review",
    );
    expect(() => parseArgs(["sessions", "--language", "en"])).toThrow("only applies");
  });

  test("the usage lists every reading verb", () => {
    let usage = "";
    try {
      parseArgs(["card", "frobnicate"]);
    } catch (error) {
      usage = (error as Error).message;
    }
    for (const line of [
      "fd card diff <card> [--json] [--config <file>]",
      "fd card spec <card> [--json] [--config <file>]",
      "fd card review <card> [--language en|pt-BR] [--json] [--config <file>]",
      "fd card message <card> <text> [--json] [--config <file>]",
      "fd card templates [--project <name or id>] [--json] [--config <file>]",
      "fd card validation-template <card> [--json] [--config <file>]",
    ])
      expect(usage).toContain(line);
  });
});
