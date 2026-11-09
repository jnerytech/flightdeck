import { describe, expect, test } from "bun:test";
import type { AppState } from "../src/lib/app-store.ts";
import { openPullRequests } from "../src/lib/pull-requests.ts";

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
