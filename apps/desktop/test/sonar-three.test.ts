import { describe, expect, test } from "bun:test";
import type { SessionNameInfo } from "@flightdeck/protocol";
import { translator } from "../src/i18n/index.ts";
import { sessionLabel } from "../src/lib/session-label.ts";

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
const worker = (number: number | null) => ({
  name: "md-server",
  role: "worker" as const,
  number,
});
const coordinator = (number: number | null) => ({
  name: "md-server",
  role: "coordinator" as const,
  number,
});
const personas = [{ id: "qa", name: "QA engineer" }];

describe("sonar-three: a team session's member part keeps its wording in every case (#363)", () => {
  for (const [lang, expected] of [
    [
      "en",
      [
        "md-server · QA engineer",
        "md-server · Worker",
        "md-server · QA engineer",
        "md-server · Coordinator",
        "md-server · Worker 4",
      ],
    ],
    [
      "pt-BR",
      [
        "md-server · QA engineer",
        "md-server · Executora",
        "md-server · QA engineer",
        "md-server · Coordenadora",
        "md-server · Executora 4",
      ],
    ],
  ] as const) {
    test(`a listed persona with no number, an unlisted one, and the roles without a persona (${lang})`, () => {
      const t = translator(lang);
      const label = (names: SessionNameInfo) => sessionLabel({ names, personas }, t);
      expect([
        label(info({ team: worker(null) })),
        label(info({ persona: "x", team: worker(null) })),
        label(info({ team: coordinator(null) })),
        label(info({ persona: "x", team: coordinator(4) })),
        label(info({ persona: "x", team: worker(4) })),
      ]).toEqual([...expected]);
    });
  }

  test("without the dictionaries a team session keeps its plain name, and a rename still wins", () => {
    const t = translator("en");
    expect([
      sessionLabel({ names: info() }),
      sessionLabel({ names: info({ standard: false, display: "own" }), createdName: "c" }, t),
    ]).toEqual(["repo · qa · card 1", "own"]);
  });
});
