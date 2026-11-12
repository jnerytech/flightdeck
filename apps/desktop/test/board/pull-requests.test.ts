import { describe, expect, test } from "bun:test";
import {
  mergeStance,
  openPullRequests,
  prFacts,
} from "../../src/features/board/pull-requests-model.ts";
import { translator } from "../../src/i18n/index.ts";
import type { AppState } from "../../src/lib/app-store.ts";

const card = (id: string, over: object = {}) =>
  ({
    id,
    projectId: "p1",
    title: `Card ${id}`,
    prUrl: `https://x/pr/${id}`,
    prState: "open",
    checksState: "passing",
    ...over,
  }) as never;

const state = (cards: Record<string, unknown>, over: object = {}) =>
  ({
    hosts: [
      { id: "h1", name: "alpha", status: "online" },
      { id: "h2", name: "beta", status: "online" },
    ],
    projects: {
      h1: [{ id: "p1", name: "api" }],
      h2: [{ id: "p1", name: "web" }],
    },
    cards,
    watches: {},
    ...over,
  }) as unknown as AppState;

const ids = (rows: ReturnType<typeof openPullRequests>) =>
  rows.map((r) => `${r.hostId}:${r.card.id}`);

describe("pull-requests: the cards with an open PR, across hosts (#1345)", () => {
  test("lists the open PRs of every online host, with the host and the project", () => {
    const rows = openPullRequests(
      state({ "h1/a": card("a"), "h2/b": card("b"), "h2/c": card("c", { prState: "merged" }) }),
    );
    expect(rows.map((r) => [r.hostName, r.projectName, r.card.id])).toEqual([
      ["alpha", "api", "a"],
      ["beta", "web", "b"],
    ]);
  });

  test("leaves out a card with no PR, a closed PR and a host that is not online", () => {
    const rows = openPullRequests(
      state(
        {
          "h1/a": card("a", { prUrl: null, prState: null }),
          "h1/b": card("b", { prState: "closed" }),
          "h1/d": card("d"),
          "h2/c": card("c"),
        },
        {
          hosts: [
            { id: "h1", name: "alpha", status: "online" },
            { id: "h2", name: "beta", status: "offline" },
          ],
        },
      ),
    );
    expect(ids(rows)).toEqual(["h1:d"]);
  });

  test("puts failing checks and a watch that needs you first, then pending, then the rest", () => {
    const rows = openPullRequests(
      state(
        {
          "h1/a": card("a"),
          "h1/b": card("b", { checksState: "pending" }),
          "h1/c": card("c", { checksState: "failing" }),
          "h2/d": card("d"),
        },
        { watches: { "h2/d": { cardId: "d", enabled: true, status: "needs_you", rounds: [] } } },
      ),
    );
    expect(ids(rows)).toEqual(["h1:c", "h2:d", "h1:b", "h1:a"]);
  });

  test("a project the host has not listed yet still shows the card, with an empty project name", () => {
    const rows = openPullRequests(state({ "h1/a": card("a", { projectId: "gone" }) }));
    expect(rows.map((r) => r.projectName)).toEqual([""]);
  });
});

describe("pull-requests: what the poll says about a PR (#1352)", () => {
  const NOW = Date.parse("2026-11-09T12:00:00Z");
  const t = translator("en");
  const tPt = translator("pt-BR");

  test("conflict, review and age come as short phrases, in that order", () => {
    const facts = prFacts(
      card("a", {
        prMergeable: "conflict",
        prReview: "changes_requested",
        prOpenedAt: "2026-11-09T09:00:00Z",
      }),
      NOW,
      t,
    );
    expect(facts).toEqual(["Conflicts with the base", "Changes requested", "Opened 3 h ago"]);
  });

  test("each merge state and review state has its own words; none says nothing", () => {
    const one = (over: object) => prFacts(card("a", over), NOW, t);
    expect([
      one({ prMergeable: "clean" }),
      one({ prMergeable: "blocked" }),
      one({ prMergeable: "unknown" }),
      one({ prReview: "approved" }),
      one({ prReview: "required" }),
      one({ prReview: "none" }),
    ]).toEqual([
      ["No conflicts"],
      ["Blocked from merging"],
      [],
      ["Approved"],
      ["Review required"],
      [],
    ]);
  });

  test("a host that reports none of it (older, or before the first poll) adds no phrase", () => {
    expect([
      prFacts(card("a"), NOW, t),
      prFacts(card("a", { prMergeable: null, prReview: null, prOpenedAt: null }), NOW, t),
    ]).toEqual([[], []]);
  });

  test("in pt-BR the phrases are translated", () => {
    expect(
      prFacts(
        card("a", {
          prMergeable: "conflict",
          prReview: "required",
          prOpenedAt: "2026-11-09T09:00:00Z",
        }),
        NOW,
        tPt,
      ),
    ).toEqual(["Em conflito com a base", "Revisão pendente", "Aberto há 3 h"]);
  });

  test("a PR in conflict, or with changes requested, needs a look before one that only waits", () => {
    const rows = openPullRequests(
      state({
        "h1/a": card("a", { checksState: "pending" }),
        "h1/b": card("b", { prMergeable: "conflict" }),
        "h1/c": card("c", { prReview: "changes_requested" }),
        "h1/d": card("d"),
      }),
    );
    expect(ids(rows)).toEqual(["h1:b", "h1:c", "h1:a", "h1:d"]);
  });
});

describe("pull-requests: can Merge PR lead the row (#1482)", () => {
  test("a conflict wins over everything; blocked, changes asked and a review needed hold it", () => {
    const stance = (over: object) => mergeStance(card("a", over));
    expect([
      stance({ prMergeable: "conflict", prReview: "changes_requested" }),
      stance({ prMergeable: "blocked", prReview: "changes_requested" }),
      stance({ prReview: "changes_requested" }),
      stance({ prReview: "required" }),
    ]).toEqual([
      { kind: "conflict" },
      { kind: "held", why: "blocked" },
      { kind: "held", why: "changes" },
      { kind: "held", why: "required" },
    ]);
  });

  test("clean, approved, unknown, or a host that reports nothing leaves Merge PR as it was", () => {
    const stance = (over: object) => mergeStance(card("a", over));
    expect([
      stance({ prMergeable: "clean", prReview: "approved" }),
      stance({ prMergeable: "unknown", prReview: "none" }),
      stance({}),
      stance({ prMergeable: null, prReview: null }),
    ]).toEqual([{ kind: "ready" }, { kind: "ready" }, { kind: "ready" }, { kind: "ready" }]);
  });

  test("the facts line can leave the conflict out, since the row shows it as a badge", () => {
    const t = translator("en");
    const over = { prMergeable: "conflict", prReview: "changes_requested" };
    expect([
      prFacts(card("a", over), Date.parse("2026-11-09T12:00:00Z"), t, false),
      prFacts(card("a", over), Date.parse("2026-11-09T12:00:00Z"), t),
    ]).toEqual([["Changes requested"], ["Conflicts with the base", "Changes requested"]]);
  });
});
