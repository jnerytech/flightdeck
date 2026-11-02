import { describe, expect, test } from "bun:test";
import type { Card } from "@flightdeck/protocol";
import { chainOf, pickable } from "../src/lib/deps.ts";

let n = 0;
const card = (id: string, extra: Partial<Card> = {}): Card =>
  ({
    id,
    projectId: "p",
    title: id.toUpperCase(),
    description: "",
    column: "backlog",
    arenaOf: null,
    blockedBy: [],
    blocking: [],
    waitingOn: [],
    position: ++n,
    ...extra,
  }) as Card;

describe("deps-ui: the blockers a card can be offered", () => {
  test("every card of the project except the card itself and the ones already blocking it", () => {
    const a = card("a");
    const b = card("b", { blockedBy: ["a"] });
    const c = card("c");
    expect(
      pickable([a, b, c], b)
        .map((x) => x.id)
        .sort(),
    ).toEqual(["c"]);
  });

  test("not a card that waits for this one, directly or down the chain: it would close a cycle", () => {
    const a = card("a");
    const b = card("b", { blockedBy: ["a"] });
    const c = card("c", { blockedBy: ["b"] });
    const d = card("d");
    expect(
      pickable([a, b, c, d], a)
        .map((x) => x.id)
        .sort(),
    ).toEqual(["d"]);
  });

  test("not a card of another project, and not an arena's variant", () => {
    const a = card("a");
    const other = card("o", { projectId: "q" });
    const variant = card("v", { arenaOf: "a" });
    expect(pickable([a, other, variant], a)).toEqual([]);
  });
});

describe("deps-ui: the chain under a card", () => {
  const a = card("a");
  const b = card("b", { blockedBy: ["a"] });
  const c = card("c", { blockedBy: ["b"] });
  const d = card("d", { blockedBy: ["c"] });
  const e = card("e", { blockedBy: ["d"] });

  test("the direct blockers, and theirs, as a tree", () => {
    const { nodes, more } = chainOf([a, b, c], c);
    expect(nodes.map((x) => x.card.id)).toEqual(["b"]);
    expect(nodes[0]?.children.map((x) => x.card.id)).toEqual(["a"]);
    expect(more).toBe(0);
  });

  test("stops at the depth and counts the cards that lie deeper", () => {
    const { nodes, more } = chainOf([a, b, c, d, e], e, 2);
    expect(nodes.map((x) => x.card.id)).toEqual(["d"]);
    expect(nodes[0]?.children.map((x) => x.card.id)).toEqual(["c"]);
    expect(nodes[0]?.children[0]?.children).toEqual([]);
    expect(more).toBe(2);
  });

  test("a card with no blockers has an empty chain", () => {
    expect(chainOf([a], a)).toEqual({ nodes: [], more: 0 });
  });
});
