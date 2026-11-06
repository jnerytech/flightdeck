import { describe, expect, test } from "bun:test";
import type { SessionNameInfo } from "@flightdeck/protocol";
import { translator } from "../src/i18n/index.ts";
import { sessionLabel } from "../src/lib/session-label.ts";

/**
 * Issue #668: a session outside a team keeps its standard name, but in the person's language. The
 * daemon builds `project · persona · number` in Portuguese; the app composes it from the parts,
 * with the persona's name from the host's list. The display name and the aliases do not change.
 */
const info = (over: Partial<SessionNameInfo> = {}): SessionNameInfo => ({
  sessionId: "s1",
  display: "app · geral · 2",
  alias: "app-geral-2",
  aliases: ["app-geral-2"],
  project: "app",
  persona: "geral",
  number: 2,
  cardNumber: null,
  standard: true,
  team: null,
  ...over,
});

const PERSONAS = {
  en: [{ id: "revisor", name: "Code reviewer" }],
  "pt-BR": [{ id: "revisor", name: "Revisor de código" }],
} as const;

describe("standard-names-i18n: a standard name in the person's language (#668)", () => {
  for (const [lang, expected] of [
    [
      "en",
      [
        "app · general · 2",
        "app · Code reviewer · 3",
        "app · Code reviewer · card 42",
        "app · Code reviewer · card 42 · 2",
        "app · seguranca · 1",
        "no project · general · 1",
      ],
    ],
    [
      "pt-BR",
      [
        "app · geral · 2",
        "app · Revisor de código · 3",
        "app · Revisor de código · card 42",
        "app · Revisor de código · card 42 · 2",
        "app · seguranca · 1",
        "sem projeto · geral · 1",
      ],
    ],
  ] as const) {
    test(`the persona's name, the general word and the card follow the language (${lang})`, () => {
      const t = translator(lang);
      const personas = [...PERSONAS[lang]];
      const label = (names: SessionNameInfo) => sessionLabel({ names, personas }, t);
      expect([
        label(info()),
        label(info({ persona: "revisor", number: 3 })),
        label(info({ persona: "revisor", number: 1, cardNumber: 42 })),
        label(info({ persona: "revisor", number: 2, cardNumber: 42 })),
        // A persona the host does not list keeps the slug the daemon gave it.
        label(info({ persona: "seguranca", number: 1 })),
        label(info({ project: "sem-projeto", persona: "geral", number: 1 })),
      ]).toEqual([...expected]);
    });
  }

  test("a renamed session, a created name and a caller with no dictionaries keep their names", () => {
    const t = translator("en");
    expect([
      sessionLabel({ names: info({ display: "my session", standard: false }) }, t),
      sessionLabel({ createdName: "named at start", names: info() }, t),
      sessionLabel({ names: info() }),
    ]).toEqual(["my session", "named at start", "app · geral · 2"]);
  });
});
