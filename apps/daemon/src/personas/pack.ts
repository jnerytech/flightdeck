import type { Language } from "./domain/language.ts";
import type { PersonaDef } from "./domain/model.ts";
import { parsePersona } from "./domain/model.ts";
import enArchitect from "./pack/en/architect.md" with { type: "text" };
import enCoordinator from "./pack/en/coordinator.md" with { type: "text" };
import enDba from "./pack/en/dba.md" with { type: "text" };
import enDev from "./pack/en/dev.md" with { type: "text" };
import enDocs from "./pack/en/docs.md" with { type: "text" };
import enFrontend from "./pack/en/frontend.md" with { type: "text" };
import enPerformance from "./pack/en/performance.md" with { type: "text" };
import enQa from "./pack/en/qa.md" with { type: "text" };
import enReviewer from "./pack/en/reviewer.md" with { type: "text" };
import enSecurity from "./pack/en/security.md" with { type: "text" };
import enSpecifier from "./pack/en/specifier.md" with { type: "text" };
import enSre from "./pack/en/sre.md" with { type: "text" };
import enUi from "./pack/en/ui.md" with { type: "text" };
import enUx from "./pack/en/ux.md" with { type: "text" };
import ptArchitect from "./pack/pt-BR/architect.md" with { type: "text" };
import ptCoordinator from "./pack/pt-BR/coordinator.md" with { type: "text" };
import ptDba from "./pack/pt-BR/dba.md" with { type: "text" };
import ptDev from "./pack/pt-BR/dev.md" with { type: "text" };
import ptDocs from "./pack/pt-BR/docs.md" with { type: "text" };
import ptFrontend from "./pack/pt-BR/frontend.md" with { type: "text" };
import ptPerformance from "./pack/pt-BR/performance.md" with { type: "text" };
import ptQa from "./pack/pt-BR/qa.md" with { type: "text" };
import ptReviewer from "./pack/pt-BR/reviewer.md" with { type: "text" };
import ptSecurity from "./pack/pt-BR/security.md" with { type: "text" };
import ptSpecifier from "./pack/pt-BR/specifier.md" with { type: "text" };
import ptSre from "./pack/pt-BR/sre.md" with { type: "text" };
import ptUi from "./pack/pt-BR/ui.md" with { type: "text" };
import ptUx from "./pack/pt-BR/ux.md" with { type: "text" };

/**
 * The files are imported as text, so they travel inside the compiled binary. They are read the way
 * a user's persona file is read, which is also what the tests of the pack rely on.
 */
const SOURCES: Record<Language, string[]> = {
  "pt-BR": [
    ptArchitect,
    ptSecurity,
    ptQa,
    ptSre,
    ptPerformance,
    ptReviewer,
    ptDocs,
    ptSpecifier,
    ptFrontend,
    ptUx,
    ptUi,
    ptDba,
    ptCoordinator,
    ptDev,
  ],
  en: [
    enArchitect,
    enSecurity,
    enQa,
    enSre,
    enPerformance,
    enReviewer,
    enDocs,
    enSpecifier,
    enFrontend,
    enUx,
    enUi,
    enDba,
    enCoordinator,
    enDev,
  ],
};

/** The ids of the personas that come ready: the spec's nine in its order, then phase 21's coordinator and the developer (issue #92), the ux and ui personas after frontend (issue #1936), and the specifier after docs (issue #1961). */
export const PACK_IDS = [
  "architect",
  "security",
  "qa",
  "sre",
  "performance",
  "reviewer",
  "docs",
  "specifier",
  "frontend",
  "ux",
  "ui",
  "dba",
  "coordinator",
  "dev",
];

/** The pack in a language; a new list every time, so nobody changes the pack by changing it. */
export function packPersonas(language: Language): PersonaDef[] {
  return SOURCES[language].map((source) => parsePersona(source));
}
