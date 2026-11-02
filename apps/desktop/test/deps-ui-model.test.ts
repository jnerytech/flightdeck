import { describe, expect, test } from "bun:test";
import type { Card } from "@flightdeck/protocol";
import { refusalText } from "../src/i18n/errors.ts";
import { translator } from "../src/i18n/index.ts";
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

describe("deps-ui: the refusals have a sentence in both languages", () => {
  const refuse = (lang: "en" | "pt-BR", reason: string, params: Record<string, string | number>) =>
    refusalText("invalid_state", "m", translator(lang), { reason, params });

  test("a blocked start names the blockers", () => {
    expect(refuse("en", "card_blocked", { blockers: "A, B" })).toBe(
      "This card is blocked by: A, B.",
    );
    expect(refuse("pt-BR", "card_blocked", { blockers: "A, B" })).toBe(
      "Este card está bloqueado por: A, B.",
    );
  });

  test("a cycle shows its path, and the limit and the other project have their own", () => {
    expect(refuse("en", "blocker_cycle", { cycle: "A → B → A" })).toBe(
      "That would close a cycle: A → B → A.",
    );
    expect(refuse("pt-BR", "blocker_limit", { max: 20 })).toBe(
      "Um card tem no máximo 20 bloqueios.",
    );
    expect(refuse("en", "blocker_other_project", {})).toBe(
      "A blocker must be a card of the same project.",
    );
  });
});
