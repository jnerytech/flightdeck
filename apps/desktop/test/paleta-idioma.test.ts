import { describe, expect, test } from "bun:test";
import { translator } from "../src/i18n/index.ts";
import type { AppState } from "../src/lib/app-store.ts";
import { paletteSections } from "../src/lib/palette.ts";

/** One online host with a live session, a terminal session, a card and a project. */
const STATE = {
  hosts: [
    {
      id: "h1",
      name: "alfa",
      status: "online",
      sessions: [{ id: "s1", name: "Alpha", cwd: "/p/alpha", status: "idle" }],
    },
  ],
  sessions: {},
  hub: {},
  externals: { "h1/e1": { claudeSessionId: "e1", cwd: "/p/term", status: "idle" } },
  meta: {},
  cards: { "h1/c1": { id: "c1", projectId: "p1", title: "Meu card" } },
  projects: { h1: [{ id: "p1", name: "repo", path: "/p/repo" }] },
} as unknown as AppState;

/** Every text of the palette, in order: titles, labels, details and the Tab actions. */
function texts(lang: "pt-BR" | "en"): string[] {
  return paletteSections(STATE, "", { costs: true, t: translator(lang) }).flatMap((section) => [
    `# ${section.title}`,
    ...section.items.map((item) =>
      [item.label, item.detail, ...item.actions.map((a) => a.label)].join(" | "),
    ),
  ]);
}

describe("paleta", () => {
  test("em português, a paleta mostra os textos de sempre", () => {
    expect(texts("pt-BR")).toEqual([
      "# Sessões ao vivo",
      "Alpha | alfa · /p/alpha | Abrir",
      "term | alfa · terminal | Abrir | Abrir no terminal",
      "# Cards",
      "Meu card | alfa · card | Abrir | Iniciar card",
      "# Projetos",
      "repo | alfa · /p/repo | Abrir board | Workflows | Abrir no terminal",
      "# Hosts",
      "alfa | online | Abrir página do host | Nova sessão | Projetos",
      "# Ações",
      "Nova sessão em alfa | ação",
      "Alternar tema | ação",
      "Trocar idioma | ação",
      "Ir para Custos | ação",
      "Ir para Configurações | ação",
    ]);
  });

  test("em inglês, a paleta mostra só inglês: títulos, ações, detalhes e rótulos", () => {
    expect(texts("en")).toEqual([
      "# Live sessions",
      "Alpha | alfa · /p/alpha | Open",
      "term | alfa · terminal | Open | Open in terminal",
      "# Cards",
      "Meu card | alfa · card | Open | Start card",
      "# Projects",
      "repo | alfa · /p/repo | Open board | Workflows | Open in terminal",
      "# Hosts",
      "alfa | online | Open host page | New session | Projects",
      "# Actions",
      "New session in alfa | action",
      "Toggle theme | action",
      "Switch language | action",
      "Go to Costs | action",
      "Go to Settings | action",
    ]);
  });
});
