import { describe, expect, test } from "bun:test";
import type { SessionNameInfo } from "@flightdeck/protocol";
import { translator } from "../src/i18n/index.ts";
import { sessionLabel } from "../src/lib/session-label.ts";

/**
 * Issue #101: a team session's name carries its persona, in the person's language. The daemon
 * sends the parts (team, role, number, persona); the app composes the label. A name the person
 * gave, or the one Claude Code gave, still wins.
 */
const info = (over: Partial<SessionNameInfo> = {}): SessionNameInfo => ({
  sessionId: "s1",
  display: "repo · qa · card 1",
  alias: "repo-qa-card-1",
  aliases: ["repo-qa-card-1"],
  project: "repo",
  persona: "qa",
  number: 1,
  cardNumber: 1,
  standard: true,
  team: { name: "md-server", role: "worker", number: 1 },
  ...over,
});

const PERSONAS = {
  en: [
    { id: "qa", name: "QA engineer" },
    { id: "arquiteto", name: "Architect" },
  ],
  "pt-BR": [
    { id: "qa", name: "Engenheira de QA" },
    { id: "arquiteto", name: "Arquiteto" },
  ],
} as const;

describe("persona-names: a team session is named by its persona, in the person's language (#101)", () => {
  for (const [lang, expected] of [
    [
      "en",
      [
        "md-server · QA engineer 1",
        "md-server · Worker 2",
        "md-server · Worker 3",
        "md-server · Architect",
        "md-server · Coordinator",
      ],
    ],
    [
      "pt-BR",
      [
        "md-server · Engenheira de QA 1",
        "md-server · Executora 2",
        "md-server · Executora 3",
        "md-server · Arquiteto",
        "md-server · Coordenadora",
      ],
    ],
  ] as const) {
    test(`workers carry their persona and number, coordinators their persona alone (${lang})`, () => {
      const t = translator(lang);
      const personas = [...PERSONAS[lang]];
      const label = (names: SessionNameInfo) => sessionLabel({ names, personas }, t);
      expect([
        label(info()),
        label(info({ persona: "geral", team: { name: "md-server", role: "worker", number: 2 } })),
        // A persona the host has not listed (yet) never shows as a slug: the role word stands in.
        label(
          info({ persona: "seguranca", team: { name: "md-server", role: "worker", number: 3 } }),
        ),
        label(
          info({
            persona: "arquiteto",
            team: { name: "md-server", role: "coordinator", number: null },
          }),
        ),
        label(
          info({
            persona: "geral",
            team: { name: "md-server", role: "coordinator", number: null },
          }),
        ),
      ]).toEqual([...expected]);
    });
  }

  test("a Flightdeck rename wins, then a Claude Code title, then the team label, then the created name, then the standard one", () => {
    const t = translator("en");
    const personas = [...PERSONAS.en];
    const created = "md-server · executora 1";
    expect([
      sessionLabel({ metaName: "mine", createdName: created, names: info(), personas }, t),
      sessionLabel(
        {
          createdName: created,
          names: info({ display: "fd-coordinator", standard: false }),
          personas,
        },
        t,
      ),
      sessionLabel({ createdName: created, names: info(), personas }, t),
      sessionLabel({ createdName: "named at start", names: info({ team: null }), personas }, t),
      sessionLabel({ names: info({ team: null }), personas }, t),
      sessionLabel({}, t),
    ]).toEqual([
      "mine",
      "fd-coordinator",
      "md-server · QA engineer 1",
      "named at start",
      "repo · qa · card 1",
      null,
    ]);
  });

  test("an older host, which sends no team and no standard mark, shows its name as it is", () => {
    const { standard: _standard, team: _team, ...older } = info({ display: "repo · geral · 4" });
    expect(sessionLabel({ names: older as SessionNameInfo }, translator("pt-BR"))).toBe(
      "repo · geral · 4",
    );
  });
});
