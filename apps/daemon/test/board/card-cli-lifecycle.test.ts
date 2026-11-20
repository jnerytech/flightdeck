import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { runCardCli } from "../../src/board/card-cli.ts";
import type { CardCliArgs } from "../../src/board/domain/card-cli-view.ts";
import type { CliResult } from "../../src/daemon-client/index.ts";
import { parseArgs } from "../../src/main.ts";
import { card, config, fakeDaemon, type Handlers, stopAll, stops } from "./card-cli-helpers.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const text = (r: CliResult) => [...r.out, ...r.err].join("\n");
const NO_CARD = { error: { code: "not_found", message: "no such card" } };

/** A daemon whose card commands answer the card they were asked about, in the state the command leaves it. */
const HANDLERS: Handlers = {
  "card.move": ({ cardId, column }) =>
    cardId === "nope" ? NO_CARD : card(String(cardId), { column: column as never }),
  "card.update": ({ cardId, title }) =>
    cardId === "nope" ? NO_CARD : card(String(cardId), { title: String(title ?? "same") }),
  "card.stop": ({ cardId }) => (cardId === "nope" ? NO_CARD : card(String(cardId))),
  "card.complete": ({ cardId }) => (cardId === "nope" ? NO_CARD : card(String(cardId))),
  "card.discard": ({ cardId }) => (cardId === "nope" ? NO_CARD : card(String(cardId))),
  "card.delete": ({ cardId }) => (cardId === "nope" ? NO_CARD : card(String(cardId))),
};

async function run(args: CardCliArgs, handlers: Handlers = HANDLERS, timeoutMs?: number) {
  const daemon = fakeDaemon(handlers);
  const result = await runCardCli(args, config(daemon.port), timeoutMs ? { timeoutMs } : {});
  return { result, calls: daemon.calls.filter((c) => c.type.startsWith("card.")) };
}

describe("card move (issue #3454)", () => {
  test("sends the column, and the position and force only when given", async () => {
    const plain = await run({ action: "move", id: "c1", column: "review" });
    expect(plain.result.code).toBe(0);
    expect(plain.result.out).toEqual(["moved c1 to review"]);
    expect(plain.calls).toEqual([
      { type: "card.move", payload: { cardId: "c1", column: "review" } },
    ]);
    const forced = await run({
      action: "move",
      id: "c1",
      column: "done",
      position: 2,
      force: true,
    });
    expect(forced.calls[0]?.payload).toEqual({
      cardId: "c1",
      column: "done",
      position: 2,
      force: true,
    });
  });

  test("--json prints the card the daemon answered", async () => {
    const { result } = await run({ action: "move", id: "c1", column: "waiting", json: true });
    expect(result.code).toBe(0);
    expect(result.out).toHaveLength(1);
    const printed = JSON.parse(result.out.join("\n")) as { id: string; column: string };
    expect([printed.id, printed.column]).toEqual(["c1", "waiting"]);
  });

  test("a column the board does not have is refused before anything is sent", async () => {
    const { result, calls } = await run({ action: "move", id: "c1", column: "doing" });
    expect(result.code).toBe(1);
    expect(result.out).toEqual([]);
    expect(text(result)).toContain("backlog, in_progress, waiting, review, done");
    expect(calls).toEqual([]);
  });

  test("a card that does not exist is exit 1 with the daemon's reason", async () => {
    const { result } = await run({ action: "move", id: "nope", column: "done" });
    expect(result.code).toBe(1);
    expect(text(result)).toContain("not_found: no such card");
  });

  test("the daemon's refusal of a column whose contract is not met is shown as it came", async () => {
    const { result } = await run(
      { action: "move", id: "c1", column: "review" },
      {
        "card.move": () => ({
          error: { code: "invalid_state", message: "the card has no branch" },
        }),
      },
    );
    expect(result.code).toBe(1);
    expect(text(result)).toContain("invalid_state: the card has no branch");
  });
});

describe("card update (issue #3454)", () => {
  test("sends only the fields given, and `none` clears the ones that can be cleared", async () => {
    const changed = await run({
      action: "update",
      id: "c1",
      title: "New title",
      description: "More text",
      estimate: "2.5",
      validationNote: "run the smoke",
      specPath: "docs/spec.md",
      blockedBy: "c2,c3",
    });
    expect(changed.result.code).toBe(0);
    expect(changed.result.out).toEqual(["updated c1  New title"]);
    expect(changed.calls[0]?.payload).toEqual({
      cardId: "c1",
      title: "New title",
      description: "More text",
      estimateHours: 2.5,
      validationNote: "run the smoke",
      specPath: "docs/spec.md",
      blockedBy: ["c2", "c3"],
    });
    const cleared = await run({
      action: "update",
      id: "c1",
      estimate: "none",
      validationNote: "none",
      specPath: "none",
      blockedBy: "none",
    });
    expect(cleared.calls[0]?.payload).toEqual({
      cardId: "c1",
      estimateHours: null,
      validationNote: null,
      specPath: null,
      blockedBy: [],
    });
  });

  test("nothing to change is refused, and an estimate that is not a number is too", async () => {
    const empty = await run({ action: "update", id: "c1" });
    expect(empty.result.code).toBe(1);
    expect(text(empty.result)).toContain("nothing to update");
    expect(empty.calls).toEqual([]);
    const bad = await run({ action: "update", id: "c1", estimate: "soon" });
    expect(bad.result.code).toBe(1);
    expect(text(bad.result)).toContain("--estimate");
    expect(bad.calls).toEqual([]);
  });

  test("an empty blocker list or a loose number is refused, only `none` clears", async () => {
    for (const patch of [
      { blockedBy: "" },
      { blockedBy: "," },
      { estimate: "1e3" },
      { estimate: "0x10" },
      { estimate: " 5 " },
      { estimate: "" },
    ]) {
      const { result, calls } = await run({ action: "update", id: "c1", ...patch });
      expect(result.code).toBe(1);
      expect(text(result)).toContain(
        Object.keys(patch)[0] === "blockedBy" ? "--blocked-by" : "--estimate",
      );
      expect(calls).toEqual([]);
    }
  });

  test("--json prints the card", async () => {
    const { result } = await run({ action: "update", id: "c1", title: "T", json: true });
    expect(result.out).toHaveLength(1);
    expect((JSON.parse(result.out.join("\n")) as { title: string }).title).toBe("T");
  });
});

describe("card stop (issue #3454)", () => {
  test("stops the card's run and says so; an unknown card is exit 1", async () => {
    const stopped = await run({ action: "stop", id: "c1" });
    expect(stopped.result.code).toBe(0);
    expect(stopped.result.out).toEqual(["stopped c1  card c1"]);
    expect(stopped.calls).toEqual([{ type: "card.stop", payload: { cardId: "c1" } }]);
    const missing = await run({ action: "stop", id: "nope" });
    expect(missing.result.code).toBe(1);
    expect(text(missing.result)).toContain("not_found: no such card");
  });
});

describe("card complete, discard and delete (issue #3454)", () => {
  for (const [action, said] of [
    ["complete", "completed"],
    ["discard", "discarded"],
    ["delete", "deleted"],
  ] as const) {
    test(`${action} without --confirm is exit 1 and sends nothing`, async () => {
      const { result, calls } = await run({ action, id: "c1" });
      expect(result.code).toBe(1);
      expect(result.out).toEqual([]);
      expect(text(result)).toContain("--confirm");
      expect(calls).toEqual([]);
    });

    test(`${action} --confirm asks the daemon with confirm and says ${said}`, async () => {
      const { result, calls } = await run({ action, id: "c1", confirm: true });
      expect(result.code).toBe(0);
      expect(result.out).toEqual([`${said} c1  card c1`]);
      expect(calls).toEqual([{ type: `card.${action}`, payload: { cardId: "c1", confirm: true } }]);
    });
  }

  test("an unknown card is exit 1 with the daemon's reason", async () => {
    const { result } = await run({ action: "discard", id: "nope", confirm: true });
    expect(result.code).toBe(1);
    expect(text(result)).toContain("not_found: no such card");
  });
});

describe("a lifecycle write that got no answer says its result is unknown (issue #3454)", () => {
  test("every one of them, so nobody retries blindly", async () => {
    const silent = fakeDaemon({});
    for (const args of [
      { action: "move", id: "c1", column: "done" },
      { action: "update", id: "c1", title: "T" },
      { action: "stop", id: "c1" },
      { action: "complete", id: "c1", confirm: true },
      { action: "discard", id: "c1", confirm: true },
      { action: "delete", id: "c1", confirm: true },
    ] as const) {
      const result = await runCardCli(args, config(silent.port), { timeoutMs: 200 });
      expect(result.code).toBe(2);
      expect(text(result)).toContain("may or may not have been");
    }
    expect(stops.length).toBeGreaterThan(0);
  });

  test("no daemon at all is exit 2", async () => {
    const gone = fakeDaemon({});
    await Promise.all(stops.splice(0).map(async (stop) => stop()));
    const result = await runCardCli({ action: "stop", id: "c1" }, config(gone.port));
    expect(result.code).toBe(2);
    expect(text(result)).toContain("could not reach the daemon");
  });
});

describe("the arguments of the lifecycle verbs (issue #3454)", () => {
  test("each verb takes its card, and move takes its column", () => {
    expect(parseArgs(["card", "move", "c1", "review"])).toMatchObject({
      command: "card",
      action: "move",
      cardId: "c1",
      column: "review",
    });
    expect(parseArgs(["card", "move", "c1", "done", "--position", "3", "--force"])).toMatchObject({
      position: 3,
      force: true,
    });
    expect(parseArgs(["card", "stop", "c1"])).toMatchObject({ action: "stop", cardId: "c1" });
    expect(parseArgs(["card", "discard", "c1", "--confirm"])).toMatchObject({
      action: "discard",
      cardId: "c1",
      confirm: true,
    });
    expect(() => parseArgs(["card", "move", "c1"])).toThrow("missing the column");
    expect(() => parseArgs(["card", "stop"])).toThrow("missing the card");
    expect(() => parseArgs(["card", "move", "c1", "done", "--position", "x"])).toThrow(
      "--position",
    );
  });

  test("update takes its fields as flags", () => {
    expect(
      parseArgs([
        "card",
        "update",
        "c1",
        "--title",
        "T",
        "--description",
        "D",
        "--estimate",
        "3",
        "--validation-note",
        "N",
        "--spec-path",
        "docs/a.md",
        "--blocked-by",
        "c2,c3",
      ]),
    ).toMatchObject({
      action: "update",
      cardId: "c1",
      cardTitle: "T",
      description: "D",
      estimate: "3",
      validationNote: "N",
      specPath: "docs/a.md",
      blockedBy: "c2,c3",
    });
  });

  test("the new flags belong to card, and --confirm takes no value", () => {
    for (const flag of [["--force"], ["--confirm"], ["--position", "1"], ["--estimate", "1"]])
      expect(() => parseArgs(["doctor", ...flag])).toThrow("only applies to flightdeckd card");
    expect(() => parseArgs(["card", "delete", "c1", "--confirm=yes"])).toThrow(
      "--confirm needs no value",
    );
  });

  test("a flag belongs to the card action that reads it, and is refused on the others", () => {
    for (const argv of [
      ["card", "stop", "c1", "--force"],
      ["card", "list", "--confirm"],
      ["card", "show", "c1", "--position", "3"],
      ["card", "move", "c1", "done", "--estimate", "5"],
      ["card", "move", "c1", "done", "--confirm"],
      ["card", "discard", "c1", "--confirm", "--force"],
      ["card", "update", "c1", "--title", "T", "--workflow", "w"],
      ["card", "new", "Real", "--title", "Other"],
      ["card", "list", "--title", "T"],
    ])
      expect(() => parseArgs(argv)).toThrow("only applies to flightdeckd card");
    expect(parseArgs(["card", "new", "Real", "--description", "D"])).toMatchObject({
      cardTitle: "Real",
      description: "D",
    });
    expect(parseArgs(["card", "start", "c1", "--workflow", "w"])).toMatchObject({ workflow: "w" });
  });

  test("the usage lists every lifecycle verb", () => {
    let usage = "";
    try {
      parseArgs(["card", "frobnicate"]);
    } catch (error) {
      usage = (error as Error).message;
    }
    for (const line of [
      "fd card move <card> <column> [--position <n>] [--force] [--json] [--config <file>]",
      "fd card update <card> [--title <text>] [--description <text>]",
      "fd card stop <card> [--json] [--config <file>]",
      "fd card complete|discard|delete <card> --confirm [--json] [--config <file>]",
    ])
      expect(usage).toContain(line);
  });
});
