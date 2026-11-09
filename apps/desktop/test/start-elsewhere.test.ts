import { describe, expect, test } from "bun:test";
import { translator } from "../src/i18n/index.ts";
import {
  type ElsewhereAnswer,
  elsewhereNotice,
  type HostFacts,
  offeredHosts,
  startElsewhere,
  waitingCards,
} from "../src/lib/start-elsewhere.ts";

/**
 * #1422 (docs/decisions/2026-11-09-start-elsewhere.md): when a Start would wait, the confirm offers
 * the other hosts that hold the same project and have the places. There is no card move between
 * hosts, so the card is made and started on the target, and only then is the source marked and
 * moved to Done (never deleted).
 */
const card = (id: string, over: object = {}) =>
  ({ id, title: `card ${id}`, description: `about ${id}`, ...over }) as never;
const ids = (cards: Array<{ id: string }>) => cards.map((c) => c.id);
const t = translator("en");

const host = (id: string, over: Partial<HostFacts> = {}): HostFacts => ({
  id,
  name: `host ${id}`,
  online: true,
  paused: false,
  projects: [{ id: `p-${id}`, key: "git:acme/app" }],
  limit: 3,
  running: 1,
  ...over,
});

describe("start-elsewhere: which cards would wait", () => {
  test("the places that are free take the first cards, the rest wait", () => {
    const cards = [card("a"), card("b"), card("c")];
    expect(ids(waitingCards(cards, { held: false, max: 2, running: 1 }))).toEqual(["b", "c"]);
  });

  test("a held or paused host makes every card wait; an unknown limit makes none", () => {
    const cards = [card("a"), card("b")];
    expect([
      ids(waitingCards(cards, { held: true, max: 5, running: 0 })),
      ids(waitingCards(cards, { held: false, max: null, running: 9 })),
    ]).toEqual([["a", "b"], []]);
  });
});

describe("start-elsewhere: which hosts are offered", () => {
  const waiting = [card("a"), card("b")];
  const offer = (hosts: HostFacts[], cards = waiting, key: string | null = "git:acme/app") =>
    offeredHosts({ waiting: cards, sourceHostId: "src", sourceKey: key, hosts }).map(
      (e) => e.hostId,
    );

  test("only another online host with the same project, not paused, with places for all of them", () => {
    expect(
      offer([
        host("ok"),
        host("src"),
        host("off", { online: false }),
        host("paused", { paused: true }),
        host("other-repo", { projects: [{ id: "x", key: "git:acme/other" }] }),
        host("full", { running: 2 }),
        host("unknown", { limit: null }),
      ]),
    ).toEqual(["ok"]);
  });

  test("the offer names the project of the target; nothing waiting or no project key offers nothing", () => {
    const [first] = offeredHosts({
      waiting,
      sourceHostId: "src",
      sourceKey: "git:acme/app",
      hosts: [host("ok")],
    });
    expect(first).toEqual({ hostId: "ok", name: "host ok", projectId: "p-ok" });
    expect([offer([host("ok")], []), offer([host("ok")], waiting, null)]).toEqual([[], []]);
  });

  test("a card whose template names a workflow or a persona is not offered: it would start differently", () => {
    expect([
      offer([host("ok")], [card("a")]),
      offer([host("ok")], [card("a", { startWorkflow: "review" })]),
      offer([host("ok")], [card("a", { startPersona: "reviewer" })]),
    ]).toEqual([["ok"], [], []]);
  });
});

describe("start-elsewhere: the hand-off", () => {
  const target = { hostId: "dst", name: "host dst", projectId: "p-dst" };
  type Call = [string, string, Record<string, unknown>];
  /** A host that answers ok, except for the call a test makes fail. */
  const asker = (fail: string | null = null) => {
    const calls: Call[] = [];
    const ask = async (
      hostId: string,
      type: string,
      payload: Record<string, unknown>,
    ): Promise<ElsewhereAnswer> => {
      calls.push([hostId, type, payload]);
      if (type === fail) return { ok: false, message: `${type} refused`, reason: "nope" };
      return { ok: true, data: type === "card.create" ? { id: `new-${payload.title}` } : {} };
    };
    return { calls, ask: ask as never };
  };
  const run = (ask: never, cards = [card("a")]) =>
    startElsewhere({ t, cards, sourceHostId: "src", target, ask });
  const summary = (calls: Call[]) => calls.map(([host, type]) => `${host} ${type}`);

  test("makes and starts the card on the target, then marks the source and moves it to Done", async () => {
    const { calls, ask } = asker();
    const outcome = await run(ask);
    expect(summary(calls)).toEqual([
      "dst card.create",
      "dst card.start",
      "src card.update",
      "src card.move",
    ]);
    expect(calls[0]?.[2]).toEqual({
      projectId: "p-dst",
      title: "card a",
      description: "about a",
    });
    expect(calls[1]?.[2]).toEqual({ cardId: "new-card a" });
    expect(String(calls[2]?.[2].description)).toContain("about a");
    expect(String(calls[2]?.[2].description)).toContain("Started on host dst as new-card a");
    expect(calls[3]?.[2]).toEqual({ cardId: "a", column: "done" });
    expect(outcome.moved.map((m) => `${m.card.id}>${m.as}`)).toEqual(["a>new-card a"]);
  });

  test("a refused create leaves the source untouched and names the card", async () => {
    const { calls, ask } = asker("card.create");
    const outcome = await run(ask);
    expect(summary(calls)).toEqual(["dst card.create"]);
    expect(outcome.refused.map((r) => r.card.id)).toEqual(["a"]);
    expect(outcome.moved).toEqual([]);
  });

  test("a refused start deletes the card just made there and leaves the source untouched", async () => {
    const { calls, ask } = asker("card.start");
    const outcome = await run(ask);
    expect(summary(calls)).toEqual(["dst card.create", "dst card.start", "dst card.delete"]);
    expect(calls[2]?.[2]).toEqual({ cardId: "new-card a", confirm: true });
    expect(outcome.refused.map((r) => r.card.id)).toEqual(["a"]);
  });

  test("a source that cannot be marked stays where it is, and is reported as started elsewhere", async () => {
    const { calls, ask } = asker("card.update");
    const outcome = await run(ask);
    expect(summary(calls)).toEqual(["dst card.create", "dst card.start", "src card.update"]);
    expect(outcome.unmarked.map((c) => c.id)).toEqual(["a"]);
    expect(outcome.moved.map((m) => m.card.id)).toEqual(["a"]);
  });

  test("a move to Done that the project refuses is reported the same way", async () => {
    const { ask } = asker("card.move");
    const outcome = await run(ask, [card("a"), card("b")]);
    expect(outcome.unmarked.map((c) => c.id)).toEqual(["a", "b"]);
  });
});

describe("start-elsewhere: what the notice says", () => {
  const names = (refused: Array<{ card: { title: string } }>) =>
    refused.map((r) => r.card.title).join(", ");
  const notice = (over: object, tt = t) =>
    elsewhereNotice(tt, { moved: [], refused: [], unmarked: [], ...over } as never, "beta", names);

  test("says how many started there, which did not start, and which stay on the board", () => {
    const a = { id: "a", title: "card a" };
    const b = { id: "b", title: "card b" };
    expect([
      notice({ moved: [{ card: a, as: "n1" }] }),
      notice({
        moved: [
          { card: a, as: "n1" },
          { card: b, as: "n2" },
        ],
      }),
      notice({ refused: [{ card: a }] }),
      notice({ refused: [{ card: a }, { card: b }] }),
      notice({ moved: [{ card: a, as: "n1" }], unmarked: [a] }),
      notice({}),
    ]).toEqual([
      "1 card started on beta.",
      "2 cards started on beta.",
      "1 card did not start: card a",
      "2 cards did not start: card a, card b",
      "1 card started on beta. Not moved to Done here: card a",
      null,
    ]);
  });

  test("in Portuguese", () => {
    const a = { id: "a", title: "card a" };
    expect(notice({ moved: [{ card: a, as: "n1" }] }, translator("pt-BR"))).toBe(
      "1 card iniciado em beta.",
    );
  });
});
