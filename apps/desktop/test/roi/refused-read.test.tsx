import { afterEach, describe, expect, test } from "bun:test";
import type { RoiSummaryResult } from "@flightdeck/protocol";
import { registerDom } from "../dom.ts";
import { settleMaybe } from "../wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { RoiTable } = await import("../../src/features/roi/roi-table.tsx");
const { RoiCard } = await import("../../src/features/roi/roi-card.tsx");
const { RoiPeople } = await import("../../src/features/roi/roi-people.tsx");
const { TContext } = await import("../../src/i18n/context.tsx");
const { translator } = await import("../../src/i18n/index.ts");

afterEach(cleanup);

type Answers = Array<{ hostId: string; result: RoiSummaryResult | null }>;
const TODAY = "2026-10-14";
const MONEY = {
  rate: null,
  billed: null,
  planShareUsd: null,
  countReview: false,
  reviewCapSeconds: 900,
};
const NOBODY = { projects: [] } as never as RoiSummaryResult;
const ANA = { id: "p1", name: "Ana", hostIds: ["h1"], tokenLimit: null, costLimit: null };

/** The part of the store the ROI screens read; `answer` is what each read of `summaries` gets. */
function roiStore(answer: { now: Answers }) {
  let reads = 0;
  const store = {
    subscribe: () => () => {},
    getState: () => ({
      roiRevision: 0,
      hosts: [
        { id: "h1", name: "alfa" },
        { id: "h2", name: "beta" },
      ],
    }),
    today: () => TODAY,
    clientScope: { get: () => ({ includes: () => true }) },
    system: { saveFile: async () => {} },
    viewPrefs: { roiOpen: () => true, saveRoiOpen: () => {} },
    roi: { data: () => ({ projectRates: {}, people: [ANA] }), setProjectRate: () => {} },
    roiFigures: {
      today: () => TODAY,
      moneyOf: () => MONEY,
      summaries: async () => {
        reads++;
        return answer.now;
      },
    },
    hostCommand: async () => ({}),
  };
  return { store: store as never, reads: () => reads };
}

const table = (store: never, hostIds: string[]) => (
  <RoiTable
    store={store}
    hostIds={hostIds}
    from="2026-10-01"
    to={TODAY}
    selection="all"
    projectName={(key) => key}
  />
);
const project = {
  id: "p1",
  path: "/work/shop",
  projectKey: "shop",
  roiSignals: { commits: false, issues: false },
  defaultHours: null,
};

for (const lang of ["en", "pt-BR"] as const) {
  const t = translator(lang);
  const wrap = (node: React.ReactNode) => (
    <TContext.Provider value={translator(lang)}>{node}</TContext.Provider>
  );
  const failedText = (hosts: string) => t("roiUi.failed", { hosts });
  const retry = () => screen.queryByRole("button", { name: t("roiUi.retry") });
  const shows = (text: string) => async () =>
    await settleMaybe(() => document.body.textContent?.includes(text) === true, 1500);

  // #4192: a host that refused is not "no data": the screen names it and offers another read.
  describe(`the ROI screens, a refused read (${lang})`, () => {
    test("the project table names the host that refused and offers Try again, not the empty line", async () => {
      const answer: { now: Answers } = { now: [{ hostId: "h1", result: null }] };
      const { store, reads } = roiStore(answer);
      render(wrap(table(store, ["h1"])));
      expect(await shows(failedText("alfa"))()).toBe(true);
      expect(retry()).not.toBeNull();
      expect(screen.queryByText(t("roiUi.table.empty"))).toBeNull();
      const before = reads();
      answer.now = [{ hostId: "h1", result: NOBODY }];
      await act(async () => {
        fireEvent.click(retry() as HTMLElement);
      });
      expect(await settleMaybe(() => reads() > before && retry() === null, 1500)).toBe(true);
      expect(screen.queryByText(failedText("alfa"))).toBeNull();
      expect(screen.queryByText(t("roiUi.table.empty"))).not.toBeNull();
    });

    test("with one host answering and one refusing, the notice names only the one that refused", async () => {
      const { store } = roiStore({
        now: [
          { hostId: "h1", result: NOBODY },
          { hostId: "h2", result: null },
        ],
      });
      render(wrap(table(store, ["h1", "h2"])));
      expect(await shows(failedText("beta"))()).toBe(true);
      expect(document.body.textContent?.includes(failedText("alfa"))).toBe(false);
      expect(retry()).not.toBeNull();
    });

    test("the people table names the host that refused and offers Try again", async () => {
      const { store } = roiStore({ now: [{ hostId: "h1", result: null }] });
      render(wrap(<RoiPeople store={store} />));
      expect(await shows(failedText("alfa"))()).toBe(true);
      expect(retry()).not.toBeNull();
      expect(screen.queryByRole("table")).toBeNull();
    });

    test("the card says the host could not be read, not that no host reports", async () => {
      const { store } = roiStore({ now: [{ hostId: "h1", result: null }] });
      render(wrap(<RoiCard store={store} hostId="h1" project={project as never} />));
      expect(await shows(failedText("alfa"))()).toBe(true);
      expect(screen.queryByText(t("roiUi.noHost"))).toBeNull();
      expect(retry()).not.toBeNull();
    });
  });
}
