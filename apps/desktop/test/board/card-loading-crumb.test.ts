import { describe, expect, test } from "bun:test";
import { translator } from "../../src/i18n/index.ts";
import { type AppState, sessionKey } from "../../src/lib/app-store.ts";
import { breadcrumb } from "../../src/lib/breadcrumb.ts";

const ID = "01M6YSQE0YHZWV";
const route = { name: "card", host: "h1", projectId: "p1", cardId: ID } as const;
const loading = {
  hosts: [{ id: "h1", name: "alfa" }],
  projects: { h1: [{ id: "p1", name: "api" }] },
  cards: {},
} as unknown as AppState;
const loaded = {
  ...loading,
  cards: { [sessionKey("h1", ID)]: { id: ID, title: "Cart screen" } },
} as unknown as AppState;

describe("card-loading-crumb: a card that is still loading is not named by its id (#1330)", () => {
  test("the tab and the breadcrumb say the card is loading, in both languages, and never show the id", () => {
    for (const [lang, text] of [
      ["en", "Loading card…"],
      ["pt-BR", "Carregando card…"],
    ] as const) {
      const labels = breadcrumb(route, loading, translator(lang)).map((crumb) => crumb.label);
      expect(labels.at(-1)).toBe(text);
      expect(labels.some((label) => label.includes(ID))).toBe(false);
    }
  });

  test("once the card arrives, its title takes the place", () => {
    const labels = breadcrumb(route, loaded, translator("en")).map((crumb) => crumb.label);
    expect(labels.at(-1)).toBe("Cart screen");
  });
});
