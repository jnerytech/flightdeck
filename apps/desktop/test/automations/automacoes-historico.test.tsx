import { afterEach, describe, expect, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform, seedHosts } from "../fixtures.ts";
import { settle } from "../wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { AutomationsPage } = await import("../../src/features/automations/page.tsx");

afterEach(cleanup);

type Lang = "en" | "pt-BR";

/** Issue #4185: the cause and the detail of a firing come from the dictionaries, in the app's language. */
const AUTOMATION = {
  id: "a1",
  projectId: "p1",
  name: "nightly",
  enabled: true,
  trigger: { type: "cron", expr: "0 9 * * 1-5", tz: "UTC" },
  action: { type: "start_workflow", workflow: "feature" },
  maxRunsPerDay: 10,
  allowExternalAuthors: false,
  createdAt: "2026-11-21T10:00:00.000Z",
};

const AT = "2026-11-21T09:30:00.000Z";
const run = (id: string, over: Record<string, unknown>) => ({
  id,
  automationId: "a1",
  firedAt: AT,
  cause: "english cause",
  status: "ok",
  detail: null,
  ...over,
});

async function history(lang: Lang, runs: unknown[]) {
  const store = new AppStore(memoryPlatform(false, lang).platform, { baseDelayMs: 600_000 });
  await store.i18n.setLang(lang);
  seedHosts(store, [{ id: "h1", name: "pc", online: true, features: ["automations"] }]);
  store.hostCommand = (async (_host: string, type: string) => {
    if (type === "automation.list") return { automations: [AUTOMATION] };
    if (type === "automation.runs") return { runs };
    return { workflows: [] };
  }) as never;
  render(<AutomationsPage store={store} hostId="h1" projectId="p1" projectName="app" />);
  await act(async () => {});
  const open = lang === "en" ? "History of nightly" : "Histórico de nightly";
  await settle(() => screen.queryByRole("button", { name: open }) !== null);
  await act(async () => {
    fireEvent.click(screen.queryByRole("button", { name: open }) as HTMLElement);
  });
  const list = lang === "en" ? "Firings of nightly" : "Disparos de nightly";
  await settle(() => screen.queryByRole("list", { name: list }) !== null);
  const items = [...(screen.queryByRole("list", { name: list })?.querySelectorAll("li") ?? [])];
  return { items: items.map((li) => li.textContent ?? ""), at: store.formatDateTime(AT) };
}

describe.each(["en", "pt-BR"] as const)("the Automations History, its words (%s)", (lang) => {
  const causes = [
    ["cron", { at: AT }],
    ["missed", { at: AT }],
    ["pr_comment", { comment: "k1", author: "ana", card: "c1" }],
    ["ci_failed", { card: "c1" }],
    ["issue_label", { issue: "#7", labels: "bug, auto" }],
  ] as const;

  test.each(causes)(
    "the cause %s is a sentence of the dictionary with its values",
    async (code, params) => {
      const { items, at } = await history(lang, [
        run("r1", { causeCode: code, causeParams: params }),
      ]);
      const said = items[0] ?? "";
      expect({
        english: said.includes("english cause"),
        iso: /\d{4}-\d\d-\d\dT\d\d:/.test(said),
        values: Object.values(params).every((v) => said.includes(v === AT ? at : String(v))),
      }).toEqual({ english: false, iso: false, values: true });
    },
  );

  const details = [
    ["not_a_card_event", {}],
    ["sent_to_card", { card: "c1" }],
    ["issue_has_card", { issue: "#7", card: "c9" }],
    ["card_made", { card: "c2" }],
    ["external_author", {}],
    ["daily_limit", { max: 10 }],
    ["daemon_stopped", {}],
  ] as const;

  test.each(details)(
    "the detail %s is a sentence of the dictionary with its values",
    async (code, params) => {
      const { items } = await history(lang, [
        run("r1", { detail: "english detail", detailCode: code, detailParams: params }),
      ]);
      const said = items[0] ?? "";
      expect({
        english: said.includes("english detail"),
        values: Object.values(params).every((v) => said.includes(String(v))),
        sentence: said.length > 0,
      }).toEqual({ english: false, values: true, sentence: true });
    },
  );

  test("the cause of each language reads as its own sentence", async () => {
    const { items, at } = await history(lang, [
      run("r1", { causeCode: "cron", causeParams: { at: AT } }),
      run("r2", { causeCode: "ci_failed", causeParams: { card: "c1" } }),
    ]);
    const want =
      lang === "en"
        ? [`Scheduled for ${at}`, "Checks of the PR of card c1 failed"]
        : [`Agendado para ${at}`, "Os checks do PR do card c1 falharam"];
    expect(want.map((text) => items.some((item) => item.includes(text)))).toEqual([true, true]);
  });

  test("a run with no code, or a code this app does not know, shows the text the host stored", async () => {
    const { items } = await history(lang, [
      run("r1", { cause: "schedule of old", detail: "card c1" }),
      run("r2", { cause: "a newer cause", causeCode: "from_the_future", causeParams: {} }),
    ]);
    expect([
      items.some((i) => i.includes("schedule of old") && i.includes("card c1")),
      items.some((i) => i.includes("a newer cause")),
    ]).toEqual([true, true]);
  });

  test("a failed run keeps the message the host stored, as it is", async () => {
    const { items } = await history(lang, [
      run("r1", { status: "failed", detail: "no runtime for that card" }),
    ]);
    expect(items[0]?.includes("no runtime for that card")).toBe(true);
  });
});
