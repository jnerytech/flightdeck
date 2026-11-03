import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { type AxeViolation, blocking, describeViolation } from "../../../scripts/lib/axe.ts";
import { item } from "../../daemon/test/boardsync-contract.ts";
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

async function boardPage(
  lang: "en" | "pt-BR",
  options: Parameters<typeof makeDaemon>[1] = { boardsync: true },
) {
  const d = makeDaemon(cleanups, options);
  d.boardProvider.items = [
    item(1, { status: "In Progress" }),
    item(2, { status: "Done", updatedAt: "2026-10-01T11:00:00Z" }),
  ];
  const repo = join(d.root, "app");
  mkdirSync(repo, { recursive: true });
  await Bun.spawn(["git", "init", "-q", repo]).exited;
  const opened: string[] = [];
  const mem = memoryPlatform(false, lang);
  const platform = {
    ...mem.platform,
    openExternal: async (url: string) => {
      opened.push(url);
    },
  };
  const store = new AppStore(platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  render(<App store={store} />);
  await act(async () => {
    await store.addHost({ name: "alfa", url: d.listen().url, token: TOKEN });
  });
  await settle(() => store.getState().hosts[0]?.status === "online");
  const hostId = store.getState().hosts[0]?.id ?? "";
  const project = await store.hostCommand(hostId, "project.add", { path: repo });
  await act(async () => {
    store.tabs.open({ name: "board", host: hostId, projectId: project?.id ?? "" });
  });
  return { d, store, hostId, projectId: project?.id ?? "", opened };
}

const click = async (name: string | RegExp) => {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
};

async function linked(lang: "en" | "pt-BR", t: typeof en) {
  const page = await boardPage(lang);
  await settle(() => screen.queryByRole("button", { name: t.boardSyncUi.button }) !== null);
  await click(t.boardSyncUi.button);
  await settle(() => screen.queryByRole("radio", { name: /Roadmap/ }) !== null);
  await act(async () => {
    fireEvent.click(screen.queryByRole("radio", { name: /Roadmap/ }) as HTMLElement);
  });
  await click(t.boardSyncUi.link);
  await settle(
    () => screen.queryByText(t.boardSyncUi.linked.replace("{title}", "Roadmap")) !== null,
  );
  return page;
}

const cardTitles = (page: Awaited<ReturnType<typeof boardPage>>) =>
  (
    page.d.eventStore.db.query("SELECT title FROM cards ORDER BY title").all() as Array<{
      title: string;
    }>
  ).map((row) => row.title);

for (const [lang, t] of [
  ["en", en],
  ["pt-BR", ptBR],
] as const) {
  describe(`board-sync-ui (${lang}): the Sync control`, () => {
    test("a host without boardsync offers nothing", async () => {
      await boardPage(lang, {});
      await act(async () => {});
      expect(screen.queryByRole("button", { name: t.boardSyncUi.button })).toBeNull();
    });

    test("not linked: the boards are listed, and linking pulls the items in as cards", async () => {
      const page = await boardPage(lang);
      await settle(() => screen.queryByRole("button", { name: t.boardSyncUi.button }) !== null);
      await click(t.boardSyncUi.button);
      await settle(() => screen.queryByText(t.boardSyncUi.notLinked) !== null);
      await settle(() => screen.queryByRole("radio", { name: /Roadmap/ }) !== null);
      expect(screen.queryByRole("button", { name: t.boardSyncUi.link })).not.toBeNull();
      await act(async () => {
        fireEvent.click(screen.queryByRole("radio", { name: /Roadmap/ }) as HTMLElement);
      });
      await click(t.boardSyncUi.link);
      await settle(
        () => screen.queryByText(t.boardSyncUi.linked.replace("{title}", "Roadmap")) !== null,
      );
      expect(cardTitles(page)).toEqual(["Item 1", "Item 2"]);
    });

    test("linked: Sync now brings a change of status from the board", async () => {
      const page = await linked(lang, t);
      page.d.boardProvider.items = [
        item(1, { status: "In Review", updatedAt: "2026-10-02T10:00:00Z" }),
        item(2, { status: "Done", updatedAt: "2026-10-01T11:00:00Z" }),
      ];
      await click(t.boardSyncUi.syncNow);
      await settle(
        () =>
          (
            page.d.eventStore.db
              .query("SELECT board_column AS c FROM cards WHERE title = 'Item 1'")
              .get() as { c: string }
          ).c === "review",
      );
      expect(screen.queryByText(t.boardSyncUi.never)).toBeNull();
    });

    test("the mapping editor lists the board's statuses with a column each, and saves a change", async () => {
      const page = await linked(lang, t);
      const dialog = within(screen.getByRole("dialog"));
      for (const status of ["Todo", "In Progress", "In Review", "Done"]) {
        expect(dialog.queryByLabelText(status)).not.toBeNull();
      }
      await act(async () => {
        fireEvent.change(dialog.queryByLabelText("In Review") as HTMLElement, {
          target: { value: "waiting" },
        });
      });
      await click(t.boardSyncUi.saveMap);
      await settle(
        () => page.d.boardSyncStore.get(page.projectId)?.columnMap["In Review"] === "waiting",
      );
    });

    test("push is off; turning it on asks first, and a login without the scope is told why", async () => {
      const page = await linked(lang, t);
      const toggle = screen.queryByRole("checkbox", {
        name: t.boardSyncUi.push,
      }) as HTMLInputElement;
      expect(toggle.checked).toBe(false);
      page.d.boardProvider.scope = { read: true, write: false };
      await act(async () => {
        fireEvent.click(toggle);
      });
      expect(screen.queryByText(t.boardSyncUi.pushConfirm)).not.toBeNull();
      expect(page.d.boardSyncStore.get(page.projectId)?.push).toBe(false);
      await click(t.boardSyncUi.pushConfirmButton);
      await settle(
        () =>
          screen.queryByText(
            t.daemonRefusal.board_sync_scope_missing.replace("{scope}", "project"),
          ) !== null,
      );
      expect(page.d.boardSyncStore.get(page.projectId)?.push).toBe(false);
      page.d.boardProvider.scope = { read: true, write: true };
      await click(t.boardSyncUi.pushConfirmButton);
      await settle(() => page.d.boardSyncStore.get(page.projectId)?.push === true);
    });

    test("unlink goes back to the list of boards", async () => {
      const page = await linked(lang, t);
      await click(t.boardSyncUi.unlink);
      await settle(() => screen.queryByText(t.boardSyncUi.notLinked) !== null);
      expect(page.d.boardSyncStore.get(page.projectId)).toBeNull();
    });

    test("a card that follows an item opens it, says when it left the board, and shows its sync log", async () => {
      const page = await linked(lang, t);
      const row = page.d.eventStore.db
        .query("SELECT id FROM cards WHERE title = 'Item 1'")
        .get() as {
        id: string;
      };
      page.d.boardSyncStore.setExternal(row.id, { externalGone: true });
      page.d.board.announce(row.id);
      page.d.boardSyncStore.addLog(row.id, {
        at: "2026-10-02T12:00:00Z",
        kind: "conflict",
        winner: "external",
        lostValue: "review",
        lostAt: "2026-10-02T11:00:00Z",
        keptValue: "Done",
        keptAt: "2026-10-02T11:30:00Z",
        detail: null,
      });
      await act(async () => {
        page.store.router.push({
          name: "card",
          host: page.hostId,
          projectId: page.projectId,
          cardId: row.id,
        });
      });
      await settle(() => screen.queryByRole("button", { name: t.boardSyncUi.openItem }) !== null);
      expect(screen.queryByText(t.boardSyncUi.gone)).not.toBeNull();
      await settle(() => screen.queryByText(t.boardSyncUi.log) !== null);
      await settle(() => document.body.textContent?.includes("Done") === true);
      await click(t.boardSyncUi.openItem);
      expect(page.opened).toEqual(["https://github.com/acme/app/issues/1"]);
    });

    test("no blocking accessibility violation with the dialog open", async () => {
      await linked(lang, t);
      const result = await axe.run(screen.getByRole("dialog"), {
        rules: { "color-contrast": { enabled: false } },
      });
      expect(
        blocking(result.violations as AxeViolation[]).map((v) => describeViolation("boardsync", v)),
      ).toEqual([]);
    });
  });
}
