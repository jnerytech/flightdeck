import { describe, expect, test } from "bun:test";
import { translator } from "../src/i18n/index.ts";
import type { AppState } from "../src/lib/app-store.ts";
import { paletteSections } from "../src/lib/palette.ts";

const named = (sessionId: string, display: string, aliases: string[]) => ({
  sessionId,
  display,
  alias: aliases[0],
  aliases,
  project: "flightdeck",
  persona: "revisor",
  number: 3,
  cardNumber: null,
});

/** A managed and a terminal session of a host with standard names. */
const STATE = {
  hosts: [
    {
      id: "h1",
      name: "alfa",
      status: "online",
      sessions: [{ id: "s1", name: null, cwd: "/p/alpha", status: "idle" }],
    },
  ],
  sessions: {},
  hub: {},
  externals: { "h1/e1": { claudeSessionId: "e1", cwd: "/p/term", status: "idle" } },
  meta: {},
  cards: {},
  projects: {},
  ssh: {},
  names: {
    h1: [
      named("s1", "flightdeck · revisor · 3", ["flightdeck-revisor-3", "login-velho"]),
      named("e1", "flightdeck · geral · 1", ["flightdeck-geral-1"]),
    ],
  },
} as unknown as AppState;

const live = (query: string) =>
  paletteSections(STATE, query, { costs: false, t: translator("pt-BR") })
    .find((s) => s.title === "Sessões ao vivo")
    ?.items.map((i) => i.label) ?? [];

describe("paleta-nomes: the standard names and aliases in the palette", () => {
  test("a session shows its standard name, managed or from the terminal", () => {
    expect(live("")).toEqual(["flightdeck · revisor · 3", "flightdeck · geral · 1"]);
  });

  test("an alias finds its session, the old one of a rename too", () => {
    expect(live("flightdeck-geral-1")).toEqual(["flightdeck · geral · 1"]);
    expect(live("login-velho")).toEqual(["flightdeck · revisor · 3"]);
  });
});
