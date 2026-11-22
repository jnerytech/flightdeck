import { afterEach, describe, expect, test } from "bun:test";
import type { CostsSummary } from "@flightdeck/protocol";
import { en } from "../../src/i18n/en.ts";
import { translator } from "../../src/i18n/index.ts";
import { ptBR } from "../../src/i18n/pt-BR.ts";
import { liveScreen, registerDom } from "../dom.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { TContext } = await import("../../src/i18n/context.tsx");
const { CostsBreakdowns, CostsTopSessions } = await import(
  "../../src/features/costs/costs-report.tsx"
);

afterEach(cleanup);

const SUMMARY = {
  byProject: [{ projectKey: "k-shop", costUsd: 3.5, tokens: 1 }],
  byModel: [{ model: "claude-opus-5-5", costUsd: 3.5, tokens: 1 }],
  byOrigin: [{ origin: "terminal", costUsd: 3.5, tokens: 1 }],
  byPersona: [],
} as unknown as CostsSummary;
const SESSION = {
  claudeSessionId: "s1",
  projectKey: "k-shop",
  title: "Fix the cart",
  cwd: null,
  costUsd: 9,
} as unknown as CostsSummary["topSessions"][number];

// Issue #3899, Costs: the breakdowns had two columns of cells with no column name and no name for
// the table, and a Top sessions row looked like plain text although a click opens the session.
for (const [lang, dict] of [
  ["en", en],
  ["pt-BR", ptBR],
] as const) {
  describe(`costs-breakdown-a11y (${lang}): reading the figures`, () => {
    test("each breakdown is a table named after its panel, with a header for the name and the cost", () => {
      render(
        <TContext.Provider value={translator(lang)}>
          <CostsBreakdowns
            summary={SUMMARY}
            projectName={() => "shop"}
            byClient={[{ name: "Acme", costUsd: 3.5 }]}
            withPersonas={false}
            personaName={(id) => id ?? ""}
          />
        </TContext.Provider>,
      );
      const names = [
        dict.costsUi.byProject,
        dict.costsUi.byClient,
        dict.costsUi.byModel,
        dict.costsUi.byOrigin,
      ];
      expect(names.map((name) => screen.queryByRole("table", { name }) !== null)).toEqual([
        true,
        true,
        true,
        true,
      ]);
      const headers = (name: string) =>
        within(screen.getByRole("table", { name }))
          .queryAllByRole("columnheader")
          .map((h) => h.textContent);
      expect(headers(dict.costsUi.byProject)).toEqual([dict.costsUi.colName, dict.costsUi.colCost]);
      expect(headers(dict.costsUi.byOrigin)).toEqual([dict.costsUi.colName, dict.costsUi.colCost]);
      // The header names the columns for a reader and draws nothing: its text is visually hidden.
      const shown = [
        ...within(screen.getByRole("table", { name: dict.costsUi.byModel })).queryAllByRole(
          "columnheader",
        ),
      ].map((h) => h.querySelector(".sr-only")?.textContent === h.textContent);
      expect(shown).toEqual([true, true]);
    });

    test("a Top sessions row has a visible cue and a description that says it opens the session, and the click still opens it", () => {
      const opened: string[] = [];
      render(
        <TContext.Provider value={translator(lang)}>
          <CostsTopSessions
            sessions={[SESSION]}
            projectName={() => "shop"}
            onOpen={(s) => opened.push(s.claudeSessionId)}
          />
        </TContext.Provider>,
      );
      const row = screen.getByRole("button", { name: /Fix the cart/ });
      expect(row.querySelector("svg")).not.toBeNull();
      const described = (row.getAttribute("aria-describedby") ?? "")
        .split(" ")
        .map((id) => document.getElementById(id)?.textContent);
      expect(described).toEqual([dict.costsUi.opensSession]);
      fireEvent.click(row);
      expect(opened).toEqual(["s1"]);
    });
  });
}
