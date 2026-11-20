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

const variant = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  label: `Variant ${id}`,
  model: null,
  effort: null,
  persona: null,
  branch: `card/${id}`,
  worktreePath: `/w/${id}`,
  queued: false,
  sessionStatus: "working",
  column: "doing",
  startedAt: null,
  endedAt: null,
  durationMs: null,
  costUsd: null,
  files: [],
  checks: [],
  notice: null,
  ...over,
});
const arena = (cardId: string) => ({
  cardId,
  variants: [
    variant("v1", {
      model: "opus",
      effort: "high",
      costUsd: 0.42,
      files: [{ path: "a.ts", additions: 3, deletions: 1 }],
    }),
    variant("v2", {
      persona: "reviewer",
      queued: true,
      sessionStatus: null,
      notice: "waiting for a slot",
    }),
  ],
});

const HANDLERS: Handlers = {
  ...HOST,
  "card.arena": ({ cardId }) =>
    cardId === "plain" ? refused("not_found", "that card has no arena") : arena(String(cardId)),
  "card.startArena": ({ cardId }) =>
    cardId === "started"
      ? refused("invalid_state", "the card already started")
      : arena(String(cardId)),
  "card.chooseVariant": ({ cardId, variantId }) =>
    variantId === "gone"
      ? refused("not_found", "no such variant")
      : card(String(cardId), { column: "review" }),
  "card.checkLoop": ({ cardId, on, rounds }) =>
    cardId === "far"
      ? refused("transport_refused", "turning the loop on needs a near connection")
      : card(String(cardId), {
          checkLoop: {
            on: Boolean(on),
            rounds: (rounds as number | undefined) ?? null,
            confirmed: true,
          },
        }),
  "card.dismissUnblocked": ({ cardId }) =>
    cardId === "nothing"
      ? refused("invalid_state", "the card is not unblocked")
      : card(String(cardId)),
};

async function run(args: CardCliArgs, handlers: Handlers = HANDLERS) {
  const daemon = fakeDaemon(handlers);
  const result = await runCardCli(args, config(daemon.port));
  return { result, calls: daemon.calls.filter((c) => c.type.startsWith("card.")) };
}

describe("card arena (issue #3454)", () => {
  test("lists each variant with its model, state and cost", async () => {
    const { result, calls } = await run({ action: "arena", id: "c1" });
    expect(result.code).toBe(0);
    expect(calls).toEqual([{ type: "card.arena", payload: { cardId: "c1" } }]);
    expect(result.out).toEqual([
      "arena of c1: 2 variants",
      "v1  Variant v1  doing  opus high  working  $0.42  1 file +3 -1",
      "v2  Variant v2  doing  default model  persona reviewer  queued",
      "  notice: waiting for a slot",
    ]);
  });

  test("--json holds the daemon's arena", async () => {
    const { result } = await run({ action: "arena", id: "c1", json: true });
    expect(printed<{ cardId: string; variants: unknown[] }>(result)).toMatchObject({
      cardId: "c1",
      variants: [{ id: "v1" }, { id: "v2" }],
    });
  });

  test("a card with no arena is exit 1 with the daemon's reason", async () => {
    const { result } = await run({ action: "arena", id: "plain" });
    expect(result.code).toBe(1);
    expect(text(result)).toContain("that card has no arena");
  });
});

describe("card start-arena (issue #3454)", () => {
  test("starts the variants it was given and lists them", async () => {
    const { result, calls } = await run({
      action: "start-arena",
      id: "c1",
      variants: ["opus:high", "sonnet::reviewer"],
      workflow: "build",
    });
    expect(result.code).toBe(0);
    expect(calls).toEqual([
      {
        type: "card.startArena",
        payload: {
          cardId: "c1",
          variants: [
            { model: "opus", effort: "high" },
            { model: "sonnet", persona: { id: "reviewer" } },
          ],
          workflow: "build",
        },
      },
    ]);
    expect(result.out[0]).toBe("started the arena of c1: 2 variants");
    expect(result.out).toHaveLength(4);
  });

  test("a variant with only an effort keeps the default model", async () => {
    const { calls } = await run({ action: "start-arena", id: "c1", variants: [":low", "opus"] });
    expect(calls[0]?.payload).toEqual({
      cardId: "c1",
      variants: [{ effort: "low" }, { model: "opus" }],
    });
  });

  test("fewer than 2 or more than 4 variants, or a bad effort, are exit 1 and send nothing", async () => {
    for (const variants of [["opus"], ["a", "b", "c", "d", "e"], ["opus:huge", "sonnet"]]) {
      const { result, calls } = await run({ action: "start-arena", id: "c1", variants });
      expect(result.code).toBe(1);
      expect(calls).toEqual([]);
    }
    const { result } = await run({ action: "start-arena", id: "c1", variants: ["opus:huge", "x"] });
    expect(text(result)).toContain("effort");
  });

  test("a refusal is exit 1 with the daemon's reason", async () => {
    const { result } = await run({ action: "start-arena", id: "started", variants: ["a", "b"] });
    expect(result.code).toBe(1);
    expect(text(result)).toContain("the card already started");
  });
});

describe("card choose-variant (issue #3454)", () => {
  test("without --confirm is exit 1 and sends nothing", async () => {
    const { result, calls } = await run({ action: "choose-variant", id: "c1", variant: "v2" });
    expect(result.code).toBe(1);
    expect(text(result)).toContain("--confirm");
    expect(calls).toEqual([]);
  });

  test("--confirm keeps the variant and says so", async () => {
    const { result, calls } = await run({
      action: "choose-variant",
      id: "c1",
      variant: "v2",
      confirm: true,
    });
    expect(result.code).toBe(0);
    expect(calls).toEqual([
      { type: "card.chooseVariant", payload: { cardId: "c1", variantId: "v2", confirm: true } },
    ]);
    expect(result.out).toEqual(["chose v2 for c1  card c1"]);
  });

  test("an unknown variant is exit 1 with the daemon's reason", async () => {
    const { result } = await run({
      action: "choose-variant",
      id: "c1",
      variant: "gone",
      confirm: true,
    });
    expect(result.code).toBe(1);
    expect(text(result)).toContain("no such variant");
  });
});

describe("card check-loop (issue #3454)", () => {
  test("on sends the switch, the rounds and the yes the person typed", async () => {
    const { result, calls } = await run({
      action: "check-loop",
      id: "c1",
      loop: "on",
      rounds: 3,
      confirm: true,
    });
    expect(result.code).toBe(0);
    expect(calls).toEqual([
      { type: "card.checkLoop", payload: { cardId: "c1", on: true, rounds: 3, confirm: true } },
    ]);
    expect(result.out).toEqual(["check loop of c1: on (up to 3 rounds)"]);
  });

  test("off sends only the switch", async () => {
    const { result, calls } = await run({ action: "check-loop", id: "c1", loop: "off" });
    expect(calls).toEqual([{ type: "card.checkLoop", payload: { cardId: "c1", on: false } }]);
    expect(result.out).toEqual(["check loop of c1: off"]);
  });

  test("without --confirm the command sends no yes: the daemon decides whether the loop needs one", async () => {
    const { result, calls } = await run({ action: "check-loop", id: "c1", loop: "on" });
    expect(result.code).toBe(0);
    expect(calls).toEqual([{ type: "card.checkLoop", payload: { cardId: "c1", on: true } }]);
  });

  test("a refusal is exit 1 with the daemon's reason", async () => {
    const { result } = await run({ action: "check-loop", id: "far", loop: "on" });
    expect(result.code).toBe(1);
    expect(text(result)).toContain("near connection");
  });

  test("--json holds the daemon's card", async () => {
    const { result } = await run({ action: "check-loop", id: "c1", loop: "on", json: true });
    expect(printed<{ id: string; checkLoop: { on: boolean } }>(result)).toMatchObject({
      id: "c1",
      checkLoop: { on: true },
    });
  });
});

describe("card dismiss-unblocked (issue #3454)", () => {
  test("clears the card's unblocked mark and says so", async () => {
    const { result, calls } = await run({ action: "dismiss-unblocked", id: "c1" });
    expect(result.code).toBe(0);
    expect(calls).toEqual([{ type: "card.dismissUnblocked", payload: { cardId: "c1" } }]);
    expect(result.out).toEqual(["dismissed the unblocked mark of c1  card c1"]);
  });

  test("a card that is not unblocked is exit 1 with the daemon's reason", async () => {
    const { result } = await run({ action: "dismiss-unblocked", id: "nothing" });
    expect(result.code).toBe(1);
    expect(text(result)).toContain("not unblocked");
  });
});

describe("a write that got no answer says its result is unknown (issue #3454)", () => {
  test("every one of the new writes, so nobody retries blindly", async () => {
    const silent = fakeDaemon({});
    for (const args of [
      { action: "start-arena", id: "c1", variants: ["a", "b"] },
      { action: "choose-variant", id: "c1", variant: "v1", confirm: true },
      { action: "check-loop", id: "c1", loop: "on" },
      { action: "dismiss-unblocked", id: "c1" },
    ] as const) {
      const result = await runCardCli(args, config(silent.port), { timeoutMs: 200 });
      expect(result.code).toBe(2);
      expect(text(result)).toContain("may or may not have been");
    }
    expect(stops.length).toBeGreaterThan(0);
  });
});

describe("the arguments of the arena and loop verbs (issue #3454)", () => {
  test("start-arena takes the card and a --variant for each variant", () => {
    expect(
      parsed([
        "card",
        "start-arena",
        "c1",
        "--variant",
        "opus:high",
        "--variant",
        "sonnet",
        "--workflow",
        "w",
      ]),
    ).toMatchObject({
      command: "card",
      action: "start-arena",
      cardId: "c1",
      variants: ["opus:high", "sonnet"],
      workflow: "w",
    });
  });

  test("choose-variant takes the card, the variant and --confirm", () => {
    expect(parsed(["card", "choose-variant", "c1", "v2", "--confirm"])).toMatchObject({
      action: "choose-variant",
      cardId: "c1",
      variant: "v2",
      confirm: true,
    });
  });

  test("check-loop takes the card, on or off, --rounds and --confirm", () => {
    expect(parsed(["card", "check-loop", "c1", "on", "--rounds", "3", "--confirm"])).toMatchObject({
      action: "check-loop",
      cardId: "c1",
      loop: "on",
      rounds: 3,
      confirm: true,
    });
    expect(parsed(["card", "check-loop", "c1", "maybe"])).toMatchObject({
      refusedWith: expect.stringContaining("on or off"),
    });
    expect(parsed(["card", "check-loop", "c1", "on", "--rounds", "11"])).toMatchObject({
      refusedWith: expect.stringContaining("--rounds"),
    });
  });

  test("arena and dismiss-unblocked take the card", () => {
    expect(parsed(["card", "arena", "c1", "--json"])).toMatchObject({
      action: "arena",
      cardId: "c1",
      json: true,
    });
    expect(parsed(["card", "dismiss-unblocked", "c1"])).toMatchObject({
      action: "dismiss-unblocked",
      cardId: "c1",
    });
  });

  test("each flag belongs to its verbs only", () => {
    const only = (flag: string) => `${flag}: this flag only applies to flightdeckd card`;
    expect(parsed(["card", "show", "c1", "--variant", "a"])).toMatchObject({
      refusedWith: expect.stringContaining(only("--variant")),
    });
    expect(parsed(["card", "start", "c1", "--rounds", "2"])).toMatchObject({
      refusedWith: expect.stringContaining(only("--rounds")),
    });
    expect(parsed(["card", "start-arena", "c1", "--confirm"])).toMatchObject({
      refusedWith: expect.stringContaining(only("--confirm")),
    });
    expect(parsed(["card", "arena", "c1", "--workflow", "w"])).toMatchObject({
      refusedWith: expect.stringContaining(only("--workflow")),
    });
  });

  test("the usage lists the five verbs", () => {
    let usage = "";
    try {
      parseArgs(["card", "nope"]);
    } catch (error) {
      usage = (error as Error).message;
    }
    for (const verb of [
      "card arena",
      "card start-arena",
      "card choose-variant",
      "card check-loop",
      "card dismiss-unblocked",
    ])
      expect(usage).toContain(verb);
  });
});
