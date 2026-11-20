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
/** The parsed arguments, or what the parser refused with: a wrong parse fails an assertion. */
function parsed(argv: string[]): unknown {
  try {
    return parseArgs(argv);
  } catch (error) {
    return { refusedWith: (error as Error).message };
  }
}
const refused = (code: string, message: string) => ({ error: { code, message } });
const URL = "https://github.com/o/r/pull/7";

const HANDLERS: Handlers = {
  ...HOST,
  "card.pr.create": ({ cardId }) =>
    cardId === "nopr"
      ? refused("invalid_state", "the project has no PR provider")
      : cardId === "secret"
        ? refused("bad_request", "the PR text looks like it has a secret (token): take it out")
        : card(String(cardId), { prUrl: URL, prState: "open" }),
  "card.updateFromBase": ({ cardId }) =>
    cardId === "conflict"
      ? refused("invalid_state", "the rebase has a conflict: nothing changed")
      : card(String(cardId)),
  "card.mergeLocal": ({ cardId }) =>
    cardId === "haspr"
      ? refused("invalid_state", "the card has a PR: the PR completes it")
      : card(String(cardId), { column: "done" }),
};

async function run(args: CardCliArgs, handlers: Handlers = HANDLERS) {
  const daemon = fakeDaemon(handlers);
  const result = await runCardCli(args, config(daemon.port));
  return { result, calls: daemon.calls.filter((c) => c.type.startsWith("card.")) };
}

describe("card pr-create (issue #3454)", () => {
  test("opens the PR and prints its link", async () => {
    const { result, calls } = await run({ action: "pr-create", id: "c1" });
    expect(result.code).toBe(0);
    expect(calls).toEqual([{ type: "card.pr.create", payload: { cardId: "c1" } }]);
    expect(result.out).toEqual([`opened the PR of c1  ${URL}`]);
  });

  test("sends the title and the description the person typed", async () => {
    const { calls } = await run({
      action: "pr-create",
      id: "c1",
      title: "A title",
      description: "The text.",
    });
    expect(calls).toEqual([
      {
        type: "card.pr.create",
        payload: { cardId: "c1", title: "A title", description: "The text." },
      },
    ]);
  });

  test("--json holds the daemon's card", async () => {
    const { result } = await run({ action: "pr-create", id: "c1", json: true });
    expect(printed<{ id: string; prUrl: string }>(result)).toMatchObject({ id: "c1", prUrl: URL });
  });

  test("a refusal is exit 1 with the daemon's reason", async () => {
    for (const id of ["nopr", "secret"]) {
      const { result } = await run({ action: "pr-create", id });
      expect(result.code).toBe(1);
      expect(result.out).toEqual([]);
    }
    const { result } = await run({ action: "pr-create", id: "nopr" });
    expect(text(result)).toContain("the project has no PR provider");
  });
});

describe("card update-from-base (issue #3454)", () => {
  test("rebases the card and says so", async () => {
    const { result, calls } = await run({ action: "update-from-base", id: "c1" });
    expect(result.code).toBe(0);
    expect(calls).toEqual([{ type: "card.updateFromBase", payload: { cardId: "c1" } }]);
    expect(result.out).toEqual(["updated c1 from its base branch"]);
  });

  test("a conflict is exit 1 and the daemon says nothing changed", async () => {
    const { result } = await run({ action: "update-from-base", id: "conflict" });
    expect(result.code).toBe(1);
    expect(text(result)).toContain("nothing changed");
  });
});

describe("card merge-local (issue #3454)", () => {
  test("without --confirm is exit 1 and sends nothing", async () => {
    const { result, calls } = await run({ action: "merge-local", id: "c1" });
    expect(result.code).toBe(1);
    expect(text(result)).toContain("--confirm");
    expect(calls).toEqual([]);
  });

  test("--confirm merges with a merge commit and says so", async () => {
    const { result, calls } = await run({ action: "merge-local", id: "c1", confirm: true });
    expect(result.code).toBe(0);
    expect(calls).toEqual([
      { type: "card.mergeLocal", payload: { cardId: "c1", mode: "merge", confirm: true } },
    ]);
    expect(result.out).toEqual(["merged c1  Card c1"]);
  });

  test("--squash and --message go to the daemon", async () => {
    const { calls } = await run({
      action: "merge-local",
      id: "c1",
      confirm: true,
      squash: true,
      message: "One commit",
    });
    expect(calls).toEqual([
      {
        type: "card.mergeLocal",
        payload: { cardId: "c1", mode: "squash", confirm: true, message: "One commit" },
      },
    ]);
  });

  test("a card with a PR is exit 1 with the daemon's reason", async () => {
    const { result } = await run({ action: "merge-local", id: "haspr", confirm: true });
    expect(result.code).toBe(1);
    expect(text(result)).toContain("the PR completes it");
  });

  test("--json holds the daemon's card", async () => {
    const { result } = await run({ action: "merge-local", id: "c1", confirm: true, json: true });
    expect(printed<{ id: string; column: string }>(result)).toMatchObject({
      id: "c1",
      column: "done",
    });
  });
});

describe("a git write that got no answer says its result is unknown (issue #3454)", () => {
  test("every one of them, so nobody retries blindly", async () => {
    const silent = fakeDaemon({});
    for (const args of [
      { action: "pr-create", id: "c1" },
      { action: "update-from-base", id: "c1" },
      { action: "merge-local", id: "c1", confirm: true },
    ] as const) {
      const result = await runCardCli(args, config(silent.port), { timeoutMs: 200 });
      expect(result.code).toBe(2);
      expect(text(result)).toContain("may or may not have been");
    }
    expect(stops.length).toBeGreaterThan(0);
  });
});

describe("the arguments of the git verbs (issue #3454)", () => {
  test("pr-create takes the card, --title and --description", () => {
    expect(
      parsed(["card", "pr-create", "c1", "--title", "T", "--description", "D", "--json"]),
    ).toMatchObject({
      command: "card",
      action: "pr-create",
      cardId: "c1",
      cardTitle: "T",
      description: "D",
      json: true,
    });
  });

  test("merge-local takes --confirm, --squash and --message", () => {
    expect(
      parsed(["card", "merge-local", "c1", "--confirm", "--squash", "--message", "M"]),
    ).toMatchObject({
      action: "merge-local",
      cardId: "c1",
      confirm: true,
      squash: true,
      answerMessage: "M",
    });
    expect(parsed(["card", "update-from-base", "c1"])).toMatchObject({
      action: "update-from-base",
      cardId: "c1",
    });
  });

  test("each flag belongs to its verbs only", () => {
    expect(() => parseArgs(["card", "show", "c1", "--squash"])).toThrow("--squash");
    expect(() => parseArgs(["card", "pr-create", "c1", "--squash"])).toThrow("--squash");
    expect(() => parseArgs(["card", "show", "c1", "--message", "m"])).toThrow("--message");
    expect(() => parseArgs(["card", "pr-create", "c1", "--confirm"])).toThrow("--confirm");
    expect(() => parseArgs(["card", "merge-local", "c1", "--title", "T"])).toThrow("--title");
  });

  test("the usage lists the three verbs", () => {
    let usage = "";
    try {
      parseArgs(["card", "nope"]);
    } catch (error) {
      usage = (error as Error).message;
    }
    for (const verb of ["card pr-create", "card update-from-base", "card merge-local"])
      expect(usage).toContain(verb);
  });
});
