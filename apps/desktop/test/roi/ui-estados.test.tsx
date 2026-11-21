import { afterEach, describe, expect, test } from "bun:test";
import type { RoiSummaryResult } from "@flightdeck/protocol";
import { registerDom } from "../dom.ts";
import { settleMaybe, waiter } from "../wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { RoiTable } = await import("../../src/features/roi/roi-table.tsx");
const { RoiCard } = await import("../../src/features/roi/roi-card.tsx");
const { TContext } = await import("../../src/i18n/context.tsx");
const { translator } = await import("../../src/i18n/index.ts");

afterEach(cleanup);
const settle = waiter(2000);

type Lang = "en" | "pt-BR";
type Answers = Array<{ hostId: string; result: RoiSummaryResult }>;
const TODAY = "2026-10-14";
const MONEY = {
  rate: null,
  billed: null,
  planShareUsd: null,
  countReview: false,
  reviewCapSeconds: 900,
};

/** The part of the store the ROI screens read; `summaries` is held until the test answers it. */
function roiStore(answered: Answers) {
  const waiting: Array<() => void> = [];
  const saved: Array<number | null> = [];
  const store = {
    subscribe: () => () => {},
    getState: () => ({ roiRevision: 0 }),
    today: () => TODAY,
    clientScope: { get: () => ({ includes: () => true }) },
    system: { saveFile: async () => {} },
    viewPrefs: { roiOpen: () => true, saveRoiOpen: () => {} },
    roi: {
      data: () => ({ projectRates: {} }),
      setProjectRate: (_key: string, rate: number | null) => saved.push(rate),
    },
    roiFigures: {
      today: () => TODAY,
      moneyOf: () => MONEY,
      summaries: () => new Promise<Answers>((resolve) => waiting.push(() => resolve(answered))),
    },
    hostCommand: async () => ({}),
  };
  return {
    store: store as never,
    answer: () => {
      for (const fn of waiting.splice(0)) fn();
    },
    saved,
  };
}

const withLang = (lang: Lang, node: React.ReactNode) => (
  <TContext.Provider value={translator(lang)}>{node}</TContext.Provider>
);

for (const lang of ["en", "pt-BR"] as const) {
  const t = translator(lang);
  describe(`the ROI screens, states (${lang})`, () => {
    test("the project table says it is loading until the hosts answer, then says it has no project", async () => {
      const { store, answer } = roiStore([]);
      render(
        withLang(
          lang,
          <RoiTable
            store={store}
            hostIds={["h1"]}
            from="2026-10-01"
            to={TODAY}
            selection="all"
            projectName={(key) => key}
          />,
        ),
      );
      await settleMaybe(
        () => screen.queryByRole("status", { name: t("roiUi.loading") }) !== null,
        600,
      );
      expect(screen.queryByRole("status", { name: t("roiUi.loading") })).not.toBeNull();
      expect(screen.queryByText(t("roiUi.table.empty"))).toBeNull();
      await act(async () => answer());
      await settle(() => screen.queryByText(t("roiUi.table.empty")) !== null);
      expect(screen.queryByRole("status", { name: t("roiUi.loading") })).toBeNull();
    });

    test("a rate or hours text that is not a number says so and saves nothing; a good one clears it", async () => {
      const { store, answer, saved } = roiStore([
        { hostId: "h1", result: { projects: [] } as never },
      ]);
      const project = {
        id: "p1",
        path: "/work/shop",
        projectKey: "shop",
        roiSignals: { commits: false, issues: false },
        defaultHours: null,
      };
      render(withLang(lang, <RoiCard store={store} hostId="h1" project={project as never} />));
      await act(async () => answer());
      await settle(() => screen.queryByLabelText(t("roiUi.projectRate")) !== null);
      const bad = t("roiUi.settingsPanel.error.number");
      await act(async () => {
        fireEvent.change(screen.getByLabelText(t("roiUi.projectRate")), {
          target: { value: "abc" },
        });
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: t("roiUi.saveRate") }));
      });
      await settleMaybe(() => screen.queryByRole("alert") !== null, 600);
      expect(screen.queryByRole("alert")?.textContent).toBe(bad);
      expect(saved).toEqual([]);
      await act(async () => {
        fireEvent.change(screen.getByLabelText(t("roiUi.defaultHours")), {
          target: { value: "1,5x" },
        });
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: t("roiUi.saveHours") }));
      });
      expect(screen.queryByRole("alert")?.textContent).toBe(bad);
      await act(async () => {
        fireEvent.change(screen.getByLabelText(t("roiUi.projectRate")), {
          target: { value: "50" },
        });
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: t("roiUi.saveRate") }));
      });
      expect(saved).toEqual([50]);
      expect(screen.queryByRole("alert")).toBeNull();
    });
  });
}
