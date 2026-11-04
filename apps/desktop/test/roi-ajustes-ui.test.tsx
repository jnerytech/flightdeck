import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { type AxeViolation, blocking, describeViolation } from "../../../scripts/lib/axe.ts";
import { en } from "../src/i18n/en.ts";
import { ptBR } from "../src/i18n/pt-BR.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";
import { waiter } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");
const axe = (await import("axe-core")).default;

setDefaultTimeout(40_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});
const settle = waiter(10_000);

async function costsPage(lang: "en" | "pt-BR", options: Parameters<typeof makeDaemon>[1] = {}) {
  const d = makeDaemon(cleanups, { roi: true, costs: true, ...options });
  const store = new AppStore(memoryPlatform(false, lang).platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  render(<App store={store} />);
  await act(async () => {
    await store.addHost({ name: "alfa", url: d.listen().url, token: TOKEN });
  });
  await settle(() => store.getState().hosts[0]?.status === "online");
  const hostId = store.getState().hosts[0]?.id ?? "";
  d.eventStore.db
    .query(
      `INSERT INTO usage_entries (message_id, claude_session_id, at, day, project_key, model, origin, speed, input, output,
         cache_read, cache_write_5m, cache_write_1h, cost_usd)
       VALUES ('u1', 's1', ?, ?, 'k', 'm', 'app', 'standard', 1, 0, 0, 0, 0, 1)`,
    )
    .run(new Date().toISOString(), new Date().toISOString().slice(0, 10));
  await act(async () => {
    store.router.push({ name: "costs" });
  });
  return { d, store, hostId };
}

const type = async (label: string, value: string) => {
  await act(async () => {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  });
};
const press = async (name: string) => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
};

for (const [lang, t] of [
  ["en", en],
  ["pt-BR", ptBR],
] as const) {
  const S = t.roiUi.settingsPanel;
  describe(`roi-ajustes-ui (${lang}): rates, review time and people`, () => {
    test("the default hourly rate is saved, and a text that is not a number is refused with the reason", async () => {
      const { store } = await costsPage(lang);
      await settle(() => screen.queryByLabelText(S.defaultRate) !== null);
      await type(S.defaultRate, "abc");
      await press(S.saveRate);
      expect(screen.queryByText(S.error.number)).not.toBeNull();
      expect(store.roi.data().defaultRate).toBeNull();
      await type(S.defaultRate, "42.5");
      await press(S.saveRate);
      expect(store.roi.data().defaultRate).toBe(42.5);
      expect(screen.queryByText(S.error.number)).toBeNull();
      await type(S.defaultRate, "");
      await press(S.saveRate);
      expect(store.roi.data().defaultRate).toBeNull();
    });

    test("review time: the switch and its cap are saved, an out-of-range cap is refused", async () => {
      const { store } = await costsPage(lang);
      await settle(() => screen.queryByLabelText(S.countReview) !== null);
      await act(async () => {
        fireEvent.click(screen.getByLabelText(S.countReview));
      });
      expect(store.roi.data().countReview).toBe(true);
      await type(S.reviewCap, "10");
      await press(S.saveCap);
      expect(store.roi.data().reviewCapMinutes).toBe(10);
      await type(S.reviewCap, "0");
      await press(S.saveCap);
      expect(screen.queryByText(S.error.review_cap_invalid)).not.toBeNull();
      expect(store.roi.data().reviewCapMinutes).toBe(10);
    });

    test("a person is added with hosts and limits, listed in the people table, and removed", async () => {
      const { store, hostId } = await costsPage(lang);
      await settle(() => screen.queryByLabelText(S.personName) !== null);
      await press(S.addPerson);
      expect(screen.queryByText(S.error.person_name_empty)).not.toBeNull();
      await type(S.personName, "Ana");
      await act(async () => {
        fireEvent.click(
          within(screen.getByRole("group", { name: S.personHosts })).getByLabelText("alfa"),
        );
      });
      await type(S.tokenLimit, "5000000");
      await type(S.costLimit, "50");
      await press(S.addPerson);
      expect(store.roi.data().people).toMatchObject([
        { name: "Ana", hostIds: [hostId], tokenLimit: 5_000_000, costLimit: 50 },
      ]);
      await settle(() => screen.queryByRole("table", { name: t.roiUi.people.title }) !== null);
      await press(S.removePerson.replace("{name}", "Ana"));
      expect(store.roi.data().people).toEqual([]);
    });

    test("a name or a host that is taken is refused with the reason, and a taken host cannot be ticked", async () => {
      const { store, hostId } = await costsPage(lang);
      store.roi.addPerson({ name: "Ana", hostIds: [hostId] });
      await settle(() => screen.queryByLabelText(S.personName) !== null);
      expect(
        (
          within(screen.getByRole("group", { name: S.personHosts })).getByLabelText(
            "alfa",
          ) as HTMLInputElement
        ).disabled,
      ).toBe(true);
      await type(S.personName, "ana");
      await press(S.addPerson);
      expect(screen.queryByText(S.error.person_name_taken)).not.toBeNull();
      expect(store.roi.data().people).toHaveLength(1);
    });

    test("a host without roi shows no settings", async () => {
      await costsPage(lang, { roi: false });
      await settle(() => screen.queryByText(t.costsUi.perDay) !== null);
      expect(screen.queryByLabelText(S.defaultRate)).toBeNull();
    });

    test("no blocking accessibility violation", async () => {
      await costsPage(lang);
      await settle(() => screen.queryByLabelText(S.defaultRate) !== null);
      const region = screen.getByLabelText(S.defaultRate).closest("section");
      const result = await axe.run(region as HTMLElement, {
        rules: { "color-contrast": { enabled: false } },
      });
      expect(
        blocking(result.violations as AxeViolation[]).map((v) =>
          describeViolation("roi-settings", v),
        ),
      ).toEqual([]);
    });
  });
}
