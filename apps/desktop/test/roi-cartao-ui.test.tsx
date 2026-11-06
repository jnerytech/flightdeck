import { afterEach, describe, expect, setDefaultTimeout, spyOn, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
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

const TODAY = "2026-10-14";
const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

interface Delivered {
  title: string;
  doneDay: string;
  createdDay: string;
  via?: string;
  fixRounds?: number;
  fixCostUsd?: number;
  hours?: number;
}

/** A host with a project, usage on given days and cards done on given days. */
async function roiPage(
  lang: "en" | "pt-BR",
  work: { usage?: Array<[string, number, number]>; done?: Delivered[]; waitedHours?: number } = {},
  options: Parameters<typeof makeDaemon>[1] = { roi: true },
) {
  const d = makeDaemon(cleanups, options);
  const repo = join(d.root, "shop");
  mkdirSync(repo, { recursive: true });
  await Bun.spawn(["git", "init", "-q", repo]).exited;
  const mem = memoryPlatform(false, lang);
  const store = new AppStore(mem.platform, {
    baseDelayMs: 60_000,
    now: () => Date.parse(`${TODAY}T12:00:00Z`),
    day: utcDay,
  });
  cleanups.push(() => store.dispose());
  render(<App store={store} />);
  await act(async () => {
    await store.addHost({ name: "alfa", url: d.listen().url, token: TOKEN });
  });
  await settle(() => store.getState().hosts[0]?.status === "online");
  const hostId = store.getState().hosts[0]?.id ?? "";
  const project = await store.hostCommand(hostId, "project.add", { path: repo });
  const key = d.keys.known(repo);
  const db = d.eventStore.db;
  let seq = 0;
  for (const [day, cost, tokens] of work.usage ?? []) {
    seq += 1;
    db.query(
      `INSERT INTO usage_entries (message_id, at, day, project_key, model, origin, speed, input, output,
         cache_read, cache_write_5m, cache_write_1h, cost_usd)
       VALUES (?, ?, ?, ?, 'm', 'app', 'standard', ?, 0, 0, 0, 0, ?)`,
    ).run(`u${seq}`, `${day}T10:00:00Z`, day, key, tokens, cost);
  }
  for (const item of work.done ?? []) {
    const card = d.board.createCard(project?.id ?? "", { title: item.title, description: "" });
    d.board.moveCard(card.id, "done");
    db.query(
      "UPDATE card_done SET done_at = ?, card_created_at = ?, via = ?, fix_rounds = ?, fix_cost_usd = ? WHERE card_id = ?",
    ).run(
      `${item.doneDay}T12:00:00Z`,
      `${item.createdDay}T09:00:00Z`,
      item.via ?? "moved",
      item.fixRounds ?? 0,
      item.fixCostUsd ?? 0,
      card.id,
    );
    if (item.hours !== undefined)
      db.query("UPDATE cards SET estimate_hours = ? WHERE id = ?").run(item.hours, card.id);
  }
  if (work.waitedHours) {
    db.query(
      `INSERT INTO sessions (id, cwd, status, permission_mode, created_at, updated_at)
       VALUES ('w1', ?, 'idle', 'default', '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z')`,
    ).run(repo);
    db.query(
      `INSERT INTO permission_requests (id, session_id, tool_name, input, status, created_at, resolved_at)
       VALUES ('q1', 'w1', 'Bash', '{}', 'allowed', '2026-10-10T08:00:00Z', ?)`,
    ).run(`2026-10-10T${String(8 + work.waitedHours).padStart(2, "0")}:00:00Z`);
  }
  await act(async () => {
    store.tabs.open({ name: "board", host: hostId, projectId: project?.id ?? "" });
  });
  return { d, store, hostId, project };
}

const SHOP: Delivered[] = [
  { title: "a", doneDay: "2026-10-05", createdDay: "2026-09-01", via: "merged" },
  { title: "b", doneDay: "2026-10-08", createdDay: "2026-09-02", via: "merged" },
  { title: "c", doneDay: "2026-10-10", createdDay: "2026-10-09", via: "completed" },
];
const USAGE: Array<[string, number, number]> = [
  ["2026-10-05", 4, 1000],
  ["2026-10-09", 4, 1000],
  ["2026-10-12", 4, 1000],
];

const click = async (name: string | RegExp) => {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
};

const plural = (entry: { one: string; other: string }, n: number) =>
  (n === 1 ? entry.one : entry.other).replace("{n}", String(n));

for (const [lang, t] of [
  ["en", en],
  ["pt-BR", ptBR],
] as const) {
  describe(`roi-cartao-ui (${lang}): the ROI card of a project`, () => {
    test("a host without roi shows no card", async () => {
      await roiPage(lang, { usage: USAGE, done: SHOP }, {});
      await act(async () => {});
      expect(screen.queryByText(t.roiUi.title)).toBeNull();
    });

    test("delivered work: the counts, the cost per card and per PR, and no value without a rate", async () => {
      await roiPage(lang, { usage: USAGE, done: SHOP });
      await settle(() => screen.queryByText(plural(t.roiUi.cardsDone, 3)) !== null);
      expect(screen.queryByText(plural(t.roiUi.prsMerged, 2))).not.toBeNull();
      expect(screen.queryByText(t.roiUi.costPerCard.replace("{each}", "US$ 4.00"))).not.toBeNull();
      expect(screen.queryByText(t.roiUi.costPerPr.replace("{each}", "US$ 6.00"))).not.toBeNull();
      expect(screen.queryByText(t.roiUi.noRate)).not.toBeNull();
      expect(document.body.textContent).not.toContain(t.roiUi.value.replace(" {value}", ""));
    });

    test("a rate with no estimated hours asks for the hours, not for a rate", async () => {
      const { store } = await roiPage(lang, { usage: USAGE, done: SHOP });
      store.roi.setDefaultRate(60);
      await settle(() => screen.queryByText(plural(t.roiUi.cardsDone, 3)) !== null);
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: t.roiUi.period7 }));
      });
      await settle(() => screen.queryByText(t.roiUi.noHours) !== null);
      expect(screen.queryByText(t.roiUi.noRate)).toBeNull();
    });

    test("it leads with delivered against cost: planned and unplanned, and the cost per item against the period before", async () => {
      await roiPage(lang, {
        usage: [...USAGE, ["2026-09-20", 10, 10]],
        done: [
          ...SHOP,
          { title: "old", doneDay: "2026-09-25", createdDay: "2026-09-01" },
          { title: "old2", doneDay: "2026-09-26", createdDay: "2026-09-01" },
        ],
      });
      const sentence = t.roiUi.headline.more
        .replace("{n}", "3")
        .replace("{planned}", "2")
        .replace("{unplanned}", "1")
        .replace("{cost}", "12.00")
        .replace("{previous}", "2")
        .replace("{movedText}", t.roiUi.moved.lower);
      await settle(() => screen.queryByText(sentence) !== null);
    });

    test("an hourly rate and hours turn delivered work into an estimated value, marked as an estimate", async () => {
      const page = await roiPage(lang, { usage: USAGE, done: SHOP });
      await act(async () => {
        page.store.roi.setDefaultRate(60);
        await page.store.hostCommand(page.hostId, "project.update", {
          projectId: page.project?.id ?? "",
          defaultHours: 2,
        });
      });
      await settle(() => screen.queryByText(t.roiUi.hours.replace("{hours}", "6")) !== null);
      expect(screen.queryByText(t.roiUi.value.replace("{value}", "US$ 360.00"))).not.toBeNull();
      expect(screen.queryByText(t.roiUi.roi.replace("{roi}", "29.0"))).not.toBeNull();
      expect(screen.queryAllByText(t.roiUi.estimate).length).toBeGreaterThan(0);
      expect(screen.queryByText(t.roiUi.noRate)).toBeNull();
    });

    test("cards without an estimate are counted, and only the ones that have one add hours", async () => {
      await roiPage(lang, {
        usage: USAGE,
        done: SHOP.map((card, i) => (i === 0 ? { ...card, hours: 3 } : card)),
      });
      await settle(() => screen.queryByText(t.roiUi.hours.replace("{hours}", "3")) !== null);
      expect(screen.queryByText(plural(t.roiUi.noEstimate, 2))).not.toBeNull();
    });

    test("the rework is shown next to the ratio", async () => {
      await roiPage(lang, {
        usage: USAGE,
        done: [{ ...(SHOP[0] as Delivered), fixRounds: 2, fixCostUsd: 1.5 }, ...SHOP.slice(1)],
      });
      await settle(
        () =>
          screen.queryByText(
            t.roiUi.rework.replace("{rounds}", "2").replace("{cost}", "US$ 1.50"),
          ) !== null,
      );
    });

    test("nothing delivered still shows the cost", async () => {
      await roiPage(lang, { usage: [["2026-10-12", 6, 10]] });
      await settle(
        () => screen.queryByText(t.roiUi.headline.none.replace("{cost}", "6.00")) !== null,
      );
    });

    test("the time requests waited for the person is information, not cost", async () => {
      await roiPage(lang, { usage: USAGE, done: SHOP, waitedHours: 3 });
      await settle(() => screen.queryByText(t.roiUi.waited.replace("{hours}", "3")) !== null);
      expect(screen.queryByText(t.roiUi.cost.replace("{cost}", "US$ 12.00"))).not.toBeNull();
    });

    test("the trend has eight weeks, as an image with a text alternative", async () => {
      await roiPage(lang, { usage: USAGE, done: SHOP });
      const prefix = t.roiUi.trendAlt.split("{")[0] ?? "";
      const find = () =>
        screen
          .queryAllByRole("img")
          .find((el) => el.getAttribute("aria-label")?.startsWith(prefix));
      await settle(() => find() !== undefined);
      expect(find()?.getAttribute("aria-label")?.split(",").length).toBeGreaterThanOrEqual(8);
    });

    test("the period switch recomputes the figures", async () => {
      await roiPage(lang, { usage: USAGE, done: SHOP });
      await settle(() => screen.queryByText(plural(t.roiUi.cardsDone, 3)) !== null);
      await click(t.roiUi.period7);
      await settle(() => screen.queryByText(plural(t.roiUi.cardsDone, 2)) !== null);
    });

    test("how it is computed opens with the numbers filled in, and is reachable by keyboard", async () => {
      const page = await roiPage(lang, { usage: USAGE, done: SHOP });
      await act(async () => {
        page.store.roi.setDefaultRate(60);
        await page.store.hostCommand(page.hostId, "project.update", {
          projectId: page.project?.id ?? "",
          defaultHours: 2,
        });
      });
      await settle(() => screen.queryByRole("button", { name: t.roiUi.how }) !== null);
      const how = screen.queryByRole("button", { name: t.roiUi.how }) as HTMLElement;
      expect(how.tabIndex).toBeGreaterThanOrEqual(0);
      await click(t.roiUi.how);
      await settle(
        () =>
          screen.queryByText(
            t.roiUi.derive.value
              .replace("{hours}", "6")
              .replace("{rate}", "60.00")
              .replace("{billed}", "0.00")
              .replace("{value}", "360.00"),
          ) !== null,
      );
      expect(screen.queryByText(t.roiUi.caveat)).not.toBeNull();
    });

    test("typing the default hours and saving sends them to the host and recomputes the hours", async () => {
      await roiPage(lang, { usage: USAGE, done: SHOP });
      await settle(() => screen.queryByLabelText(t.roiUi.defaultHours) !== null);
      await act(async () => {
        fireEvent.change(screen.getByLabelText(t.roiUi.defaultHours), { target: { value: "2" } });
      });
      expect((screen.getByLabelText(t.roiUi.defaultHours) as HTMLInputElement).value).toBe("2");
      await click(t.roiUi.saveHours);
      await settle(() => screen.queryByText(t.roiUi.hours.replace("{hours}", "6")) !== null);
    });

    test("typing a project rate and saving keeps it in the app and turns hours into a value", async () => {
      const page = await roiPage(lang, { usage: USAGE, done: SHOP });
      await act(async () => {
        await page.store.hostCommand(page.hostId, "project.update", {
          projectId: page.project?.id ?? "",
          defaultHours: 2,
        });
      });
      await settle(() => screen.queryByLabelText(t.roiUi.projectRate) !== null);
      await settle(() => screen.queryByText(t.roiUi.hours.replace("{hours}", "6")) !== null);
      expect(screen.queryByText(t.roiUi.noRate)).not.toBeNull();
      await act(async () => {
        fireEvent.change(screen.getByLabelText(t.roiUi.projectRate), { target: { value: "50" } });
      });
      expect((screen.getByLabelText(t.roiUi.projectRate) as HTMLInputElement).value).toBe("50");
      await click(t.roiUi.saveRate);
      await settle(
        () => screen.queryByText(t.roiUi.value.replace("{value}", "US$ 300.00")) !== null,
      );
      expect(Object.values(page.store.roi.data().projectRates)).toEqual([50]);
    });

    test("the card refreshes on its 30 second timer", async () => {
      const original = globalThis.setInterval;
      const ticks: Array<() => void> = [];
      const interval = spyOn(globalThis, "setInterval").mockImplementation(((
        fn: () => void,
        ms?: number,
      ) => {
        if (ms === 30_000) ticks.push(fn);
        return original(fn, ms);
      }) as unknown as typeof setInterval);
      try {
        const { d } = await roiPage(lang, { usage: USAGE, done: SHOP });
        await settle(
          () => screen.queryByText(t.roiUi.cost.replace("{cost}", "US$ 12.00")) !== null,
        );
        expect(ticks.length).toBeGreaterThan(0);
        const key = d.keys.known(join(d.root, "shop"));
        d.eventStore.db
          .query(
            `INSERT INTO usage_entries (message_id, at, day, project_key, model, origin, speed, input, output,
               cache_read, cache_write_5m, cache_write_1h, cost_usd)
             VALUES ('late', '2026-10-12T11:00:00Z', '2026-10-12', ?, 'm', 'app', 'standard', 1, 0, 0, 0, 0, 3)`,
          )
          .run(key);
        expect(screen.queryByText(t.roiUi.cost.replace("{cost}", "US$ 15.00"))).toBeNull();
        await act(async () => {
          for (const tick of ticks) tick();
        });
        await settle(
          () => screen.queryByText(t.roiUi.cost.replace("{cost}", "US$ 15.00")) !== null,
        );
      } finally {
        interval.mockRestore();
      }
    });

    test("no blocking accessibility violation", async () => {
      await roiPage(lang, { usage: USAGE, done: SHOP });
      await settle(() => screen.queryByText(plural(t.roiUi.cardsDone, 3)) !== null);
      expect(screen.queryByText(plural(t.roiUi.cardsDone, 3))).not.toBeNull();
      expect(screen.queryByText(plural(t.roiUi.cardsDone, 3))).not.toBeNull();
      expect(screen.queryByText(plural(t.roiUi.cardsDone, 3))).not.toBeNull();
      const result = await axe.run(document.body, {
        rules: { "color-contrast": { enabled: false } },
      });
      expect(
        blocking(result.violations as AxeViolation[]).map((v) => describeViolation("roi", v)),
      ).toEqual([]);
    });
  });
}
