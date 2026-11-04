import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
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

/** A host with two projects: shop delivered three cards for US$ 12, blog only cost US$ 3. */
async function costsPage(lang: "en" | "pt-BR", options: Parameters<typeof makeDaemon>[1] = {}) {
  const d = makeDaemon(cleanups, { roi: true, costs: true, ...options });
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
  const db = d.eventStore.db;
  let seq = 0;
  for (const [name, cost, cards] of [
    ["shop", 12, 3],
    ["blog", 3, 0],
  ] as const) {
    const repo = join(d.root, name);
    mkdirSync(repo, { recursive: true });
    await Bun.spawn(["git", "init", "-q", repo]).exited;
    const project = await store.hostCommand(hostId, "project.add", { path: repo });
    seq += 1;
    db.query(
      `INSERT INTO usage_entries (message_id, claude_session_id, at, day, project_key, model, origin, speed, input, output,
         cache_read, cache_write_5m, cache_write_1h, cost_usd)
       VALUES (?, ?, ?, ?, ?, 'm', 'app', 'standard', 1000, 0, 0, 0, 0, ?)`,
    ).run(`u${seq}`, `s${seq}`, "2026-10-09T10:00:00Z", "2026-10-09", d.keys.known(repo), cost);
    for (let i = 0; i < cards; i += 1) {
      const card = d.board.createCard(project?.id ?? "", { title: `c${i}`, description: "" });
      d.board.moveCard(card.id, "done");
      db.query("UPDATE card_done SET done_at = ?, via = 'merged' WHERE card_id = ?").run(
        "2026-10-10T12:00:00Z",
        card.id,
      );
    }
  }
  await act(async () => {
    store.router.push({ name: "costs" });
  });
  return { d, store, hostId };
}

const dataRows = () =>
  within(screen.getByRole("table", { name: /.+/ }))
    .getAllByRole("row")
    .slice(1);
const cellsOf = (row: HTMLElement) => [...row.querySelectorAll("th,td")].map((c) => c.textContent);

for (const [lang, t] of [
  ["en", en],
  ["pt-BR", ptBR],
] as const) {
  describe(`roi-tabela-ui (${lang}): the project table on the Costs screen`, () => {
    test("one row per project with its figures, '—' where one cannot be computed, and a footer", async () => {
      await costsPage(lang);
      await settle(() => screen.queryByRole("table", { name: t.roiUi.tableTitle }) !== null);
      await settle(() => screen.queryAllByRole("row").length >= 4);
      const rows = dataRows();
      expect(rows).toHaveLength(3);
      const byName = Object.fromEntries(rows.map((r) => [cellsOf(r)[0], cellsOf(r)] as const));
      expect(byName.shop?.[2]).toBe("3");
      expect(byName.shop?.[3]).toBe("3");
      expect(byName.shop?.[4]).toContain("4.00");
      expect(byName.blog?.[2]).toBe("0");
      expect(byName.blog?.[4]).toBe("—");
      expect(byName.blog?.[7]).toBe("—");
      const footer = rows.at(-1);
      expect(cellsOf(footer as HTMLElement)[0]).toBe(t.roiUi.table.total);
      expect(cellsOf(footer as HTMLElement)[1]).toContain("15.00");
      expect(cellsOf(footer as HTMLElement)[2]).toBe("3");
    });

    test("a column header sorts both ways and says which way it is sorted", async () => {
      await costsPage(lang);
      await settle(() => screen.queryByRole("table", { name: t.roiUi.tableTitle }) !== null);
      const names = () =>
        dataRows()
          .slice(0, -1)
          .map((r) => cellsOf(r)[0]);
      const header = (name: string) => screen.getByRole("columnheader", { name });
      await act(async () => {
        fireEvent.click(within(header(t.roiUi.table.cost)).getByRole("button"));
      });
      const asc = names();
      expect(header(t.roiUi.table.cost).getAttribute("aria-sort")).toBe("ascending");
      await act(async () => {
        fireEvent.click(within(header(t.roiUi.table.cost)).getByRole("button"));
      });
      expect(header(t.roiUi.table.cost).getAttribute("aria-sort")).toBe("descending");
      expect(names()).toEqual([...asc].reverse());
      await act(async () => {
        fireEvent.click(within(header(t.roiUi.table.project)).getByRole("button"));
      });
      expect(names()).toEqual(["blog", "shop"]);
      expect(header(t.roiUi.table.cost).getAttribute("aria-sort")).toBeNull();
    });

    test("a host without roi shows no table", async () => {
      await costsPage(lang, { roi: false });
      await settle(() => screen.queryByText(t.costsUi.perDay) !== null);
      expect(screen.queryByRole("table", { name: t.roiUi.tableTitle })).toBeNull();
    });

    test("no blocking accessibility violation", async () => {
      await costsPage(lang);
      await settle(() => screen.queryByRole("table", { name: t.roiUi.tableTitle }) !== null);
      const region = screen.getByRole("table", { name: t.roiUi.tableTitle }).closest("section");
      const result = await axe.run(region as HTMLElement, {
        rules: { "color-contrast": { enabled: false } },
      });
      expect(
        blocking(result.violations as AxeViolation[]).map((v) => describeViolation("roi-table", v)),
      ).toEqual([]);
    });
  });
}
