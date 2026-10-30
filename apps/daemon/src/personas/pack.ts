import type { PersonaDef } from "./model.ts";
import { parsePersona } from "./model.ts";
import enArquiteto from "./pack/en/arquiteto.md" with { type: "text" };
import enCoordenador from "./pack/en/coordenador.md" with { type: "text" };
import enDba from "./pack/en/dba.md" with { type: "text" };
import enDocs from "./pack/en/docs.md" with { type: "text" };
import enFrontend from "./pack/en/frontend.md" with { type: "text" };
import enPerformance from "./pack/en/performance.md" with { type: "text" };
import enQa from "./pack/en/qa.md" with { type: "text" };
import enRevisor from "./pack/en/revisor.md" with { type: "text" };
import enSeguranca from "./pack/en/seguranca.md" with { type: "text" };
import enSre from "./pack/en/sre.md" with { type: "text" };
import ptArquiteto from "./pack/pt-BR/arquiteto.md" with { type: "text" };
import ptCoordenador from "./pack/pt-BR/coordenador.md" with { type: "text" };
import ptDba from "./pack/pt-BR/dba.md" with { type: "text" };
import ptDocs from "./pack/pt-BR/docs.md" with { type: "text" };
import ptFrontend from "./pack/pt-BR/frontend.md" with { type: "text" };
import ptPerformance from "./pack/pt-BR/performance.md" with { type: "text" };
import ptQa from "./pack/pt-BR/qa.md" with { type: "text" };
import ptRevisor from "./pack/pt-BR/revisor.md" with { type: "text" };
import ptSeguranca from "./pack/pt-BR/seguranca.md" with { type: "text" };
import ptSre from "./pack/pt-BR/sre.md" with { type: "text" };

export type Language = "pt-BR" | "en";

/**
 * The files are imported as text, so they travel inside the compiled binary. They are read the way
 * a user's persona file is read, which is also what the tests of the pack rely on.
 */
const SOURCES: Record<Language, string[]> = {
  "pt-BR": [
    ptArquiteto,
    ptSeguranca,
    ptQa,
    ptSre,
    ptPerformance,
    ptRevisor,
    ptDocs,
    ptFrontend,
    ptDba,
    ptCoordenador,
  ],
  en: [
    enArquiteto,
    enSeguranca,
    enQa,
    enSre,
    enPerformance,
    enRevisor,
    enDocs,
    enFrontend,
    enDba,
    enCoordenador,
  ],
};

/** The ids of the personas that come ready: the spec's nine in its order, then phase 21's coordinator. */
export const PACK_IDS = [
  "arquiteto",
  "seguranca",
  "qa",
  "sre",
  "performance",
  "revisor",
  "docs",
  "frontend",
  "dba",
  "coordenador",
];

/** The pack in a language; a new list every time, so nobody changes the pack by changing it. */
export function packPersonas(language: Language): PersonaDef[] {
  return SOURCES[language].map((source) => parsePersona(source));
}
