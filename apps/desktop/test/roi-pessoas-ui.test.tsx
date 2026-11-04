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
const { act, cleanup, render, within } = await import("@testing-library/react");
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

/** A host that used 3.1 million tokens this month and delivered 7 cards, 4 of them as merged PRs. */
async function costsPage(
  lang: "en" | "pt-BR",
  people: Array<{ name: string; tokenLimit?: number | null; costLimit?: number | null }>,
  work = { tokens: 3_100_000, merged: 4, completed: 3 },
  options: Parameters<typeof makeDaemon>[1] = {},
) {
  const d = makeDaemon(cleanups, { roi: true, costs: true, ...options });
  const store = new AppStore(memoryPlatform(false, lang).platform, {
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
  const repo = join(d.root, "shop");
  mkdirSync(repo, { recursive: true });
  await Bun.spawn(["git", "init", "-q", repo]).exited;
  const project = await store.hostCommand(hostId, "project.add", { path: repo });
  d.eventStore.db
    .query(
      `INSERT INTO usage_entries (message_id, claude_session_id, at, day, project_key, model, origin, speed, input, output,
         cache_read, cache_write_5m, cache_write_1h, cost_usd)
       VALUES ('u1', 's1', '2026-10-09T10:00:00Z', '2026-10-09', ?, 'm', 'app', 'standard', ?, 0, 0, 0, 0, 12)`,
    )
    .run(d.keys.known(repo), work.tokens);
  for (const [via, n] of [
    ["merged", work.merged],
    ["completed", work.completed],
  ] as const) {
    for (let i = 0; i < n; i += 1) {
      const card = d.board.createCard(project?.id ?? "", { title: `${via}${i}`, description: "" });
      d.board.moveCard(card.id, "done");
      d.eventStore.db
        .query("UPDATE card_done SET done_at = ?, via = ? WHERE card_id = ?")
        .run("2026-10-10T12:00:00Z", via, card.id);
    }
  }
  for (const person of people) store.roi.addPerson({ ...person, hostIds: [hostId] });
  await act(async () => {
    store.router.push({ name: "costs" });
  });
  return { d, store, hostId };
}

const peopleTable = (t: typeof en) => screen.queryByRole("table", { name: t.roiUi.people.title });
const rowOf = (name: string) => {
  const row = screen.getAllByRole("row").find((r) => r.querySelector("th")?.textContent === name);
  return row?.textContent ?? "";
};

for (const [lang, t] of [
  ["en", en],
  ["pt-BR", ptBR],
] as const) {
  const T = t as typeof en;
  describe(`roi-pessoas-ui (${lang}): tokens against delivery, by person`, () => {
    test("a person sees tokens used against the limit, what was delivered, and tokens per card", async () => {
      await costsPage(lang, [{ name: "Ana", tokenLimit: 5_000_000 }]);
      await settle(() => peopleTable(T) !== null);
      const text = rowOf("Ana");
      expect(text).toContain(
        T.roiUi.people.shareOfLimit
          .replace("{share}", "62")
          .replace("{limit}", T.roiUi.people.tokens.million.replace("{n}", "5")),
      );
      expect(text).toContain(
        `${T.roiUi.people.cards.other.replace("{n}", "7")}, ${T.roiUi.people.prs.other.replace("{n}", "4")}`,
      );
      expect(text).toContain(T.roiUi.people.tokens.million.replace("{n}", "0.44"));
    });

    test("a person without a limit shows usage only, and no card done shows a dash", async () => {
      await costsPage(lang, [{ name: "Bo" }], { tokens: 2_000, merged: 0, completed: 0 });
      await settle(() => peopleTable(T) !== null);
      const text = rowOf("Bo");
      expect(text).toContain(
        T.roiUi.people.noLimit.replace(
          "{used}",
          T.roiUi.people.tokens.thousand.replace("{n}", "2"),
        ),
      );
      expect(text).not.toContain("%");
      expect(text.endsWith("—")).toBe(true);
    });

    test("a cost limit shows its share too", async () => {
      await costsPage(lang, [{ name: "Cy", costLimit: 48 }]);
      await settle(() => peopleTable(T) !== null);
      expect(rowOf("Cy")).toContain(
        T.roiUi.people.shareOfLimit.replace("{share}", "25").replace("{limit}", "US$ 48.00"),
      );
    });

    test("people are listed by name, not by delivery, and the page says it is not a ranking", async () => {
      await costsPage(lang, [{ name: "Zed" }, { name: "Ana" }]);
      await settle(() => peopleTable(T) !== null);
      const names = within(peopleTable(T) as HTMLElement)
        .getAllByRole("rowheader")
        .map((h) => h.textContent);
      expect(names).toEqual(["Ana", "Zed"]);
      expect(screen.queryByText(T.roiUi.people.note)).not.toBeNull();
    });

    test("with no person set up there is a hint and no table", async () => {
      await costsPage(lang, []);
      await settle(() => screen.queryByText(T.roiUi.people.empty) !== null);
      expect(peopleTable(T)).toBeNull();
    });

    test("a host without roi shows nothing about people", async () => {
      await costsPage(lang, [{ name: "Ana" }], undefined, { roi: false });
      await settle(() => screen.queryByText(T.costsUi.perDay) !== null);
      expect(screen.queryByText(T.roiUi.people.title)).toBeNull();
      expect(screen.queryByText(T.roiUi.people.empty)).toBeNull();
    });

    test("no blocking accessibility violation", async () => {
      await costsPage(lang, [{ name: "Ana", tokenLimit: 5_000_000 }]);
      await settle(() => peopleTable(T) !== null);
      const region = (peopleTable(T) as HTMLElement).closest("section");
      const result = await axe.run(region as HTMLElement, {
        rules: { "color-contrast": { enabled: false } },
      });
      expect(
        blocking(result.violations as AxeViolation[]).map((v) =>
          describeViolation("roi-people", v),
        ),
      ).toEqual([]);
    });
  });
}
