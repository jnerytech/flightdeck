import { afterEach, describe, expect, test } from "bun:test";
import { registerDom } from "./dom.ts";

registerDom();
const { act, cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");
const { TContext } = await import("../src/i18n/context.tsx");
const { translator } = await import("../src/i18n/index.ts");
const { UsagePanel } = await import("../src/ui/UsagePanel.tsx");
const { HistoryList } = await import("../src/ui/HistoryList.tsx");
const { I18n } = await import("../src/i18n/index.ts");

import type { AppStore } from "../src/lib/app-store.ts";

afterEach(cleanup);

const BY_DAY = [
  { day: "2026-10-15", projectKey: "host:h:/home/ana/entrevista", costUsd: 1.5, tokens: 10 },
  { day: "2026-10-14", projectKey: "host:h:/home/ana/entrevista", costUsd: 2, tokens: 10 },
  { day: "2026-10-15", projectKey: "host:h:/tmp/run-1", costUsd: 40, tokens: 10 },
  {
    day: "2026-10-15",
    projectKey: "host:h:/home/ana/app/.claude/worktrees/agent-3",
    costUsd: 9,
    tokens: 1,
  },
  { day: "2026-10-15", projectKey: "github.com/acme/repo", costUsd: 0.5, tokens: 10 },
];

const fakeStore = () =>
  ({
    today: () => "2026-10-16",
    hostCommand: () => Promise.resolve({ byDay: BY_DAY }),
  }) as unknown as AppStore;

async function panel(
  onOpenHistory = (_f: { cwd?: string; projectKey?: string; day: string }) => {},
) {
  const view = render(
    <TContext.Provider value={translator("en")}>
      <UsagePanel store={fakeStore()} hostId="h" online costs onOpenHistory={onOpenHistory} />
    </TContext.Provider>,
  );
  await waitFor(() => expect(view.container.querySelector("table")).not.toBeNull());
  return view;
}

describe("uso-tabela-ui: the host's usage table", () => {
  test("temp folders and agent worktrees are not listed; projects group with their total", async () => {
    const view = await panel();
    const text = view.container.textContent ?? "";
    expect(text).not.toContain("run-1");
    expect(text).not.toContain("agent-3");
    const heads = [...view.container.querySelectorAll("tbody th")].map((th) => th.textContent);
    expect(heads).toEqual(["entrevistaUS$ 3.50", "repoUS$ 0.50"]);
  });

  test("the day and the cost never wrap", async () => {
    const view = await panel();
    const cells = view.container.querySelectorAll("tbody td");
    expect(cells.length).toBeGreaterThan(0);
    for (const td of cells) {
      if (td.querySelector("button") || /US\$/.test(td.textContent ?? "")) {
        expect(td.className).toContain("whitespace-nowrap");
      }
    }
  });

  test("a row opens the history of its folder and day; a remote project gives its key and the day", async () => {
    const opened: Array<{ cwd?: string; projectKey?: string; day: string }> = [];
    const view = await panel((f) => opened.push(f));
    const buttons = [...view.container.querySelectorAll("tbody button")] as HTMLElement[];
    await act(async () => {
      fireEvent.click(buttons[0] as HTMLElement);
      fireEvent.click(buttons[2] as HTMLElement);
    });
    expect(opened).toEqual([
      { cwd: "/home/ana/entrevista", day: "2026-10-15" },
      { projectKey: "github.com/acme/repo", day: "2026-10-15" },
    ]);
  });
});

describe("uso-tabela-ui: the history list opened from a usage row", () => {
  test("it starts filtered by the folder and the day", async () => {
    const asked: unknown[] = [];
    const store = {
      i18n: new I18n({ settings: { get: () => null, set: () => {} } } as never),
      historyList: (_host: string, filter: unknown) => {
        asked.push(filter);
        return Promise.resolve({ sessions: [], nextCursor: null });
      },
      formatDateTime: String,
      router: { push: () => {} },
    } as unknown as AppStore;
    const list = (initial: { cwd?: string; projectKey?: string; day?: string } | undefined) => (
      <HistoryList
        store={store}
        hostId="h"
        hostName="pc"
        density="comfortable"
        openId={null}
        onOpen={() => {}}
        initial={initial}
      />
    );
    const view = render(list({ cwd: "/home/ana/entrevista", day: "2026-10-15" }));
    await waitFor(() => expect(asked.length).toBeGreaterThan(0));
    expect(asked[0]).toMatchObject({
      cwd: "/home/ana/entrevista",
      from: "2026-10-15T00:00:00.000Z",
      to: "2026-10-15T23:59:59.999Z",
    });
    expect(document.querySelector<HTMLInputElement>("input[aria-label='Pasta']")?.value).toBe(
      "/home/ana/entrevista",
    );

    // Another usage row opens it again: the filter follows; a plain reopen keeps what is there.
    view.rerender(list({ day: "2026-10-14" }));
    await waitFor(() => expect(asked.at(-1)).toMatchObject({ from: "2026-10-14T00:00:00.000Z" }));
    expect(asked.at(-1)).not.toHaveProperty("cwd");
    const count = asked.length;
    view.rerender(list(undefined));
    await act(() => Bun.sleep(30));
    expect(asked).toHaveLength(count);
  });

  test("a project key filters the list, shows as a chip, and the chip clears it", async () => {
    const asked: unknown[] = [];
    const store = {
      i18n: new I18n({ settings: { get: () => null, set: () => {} } } as never),
      historyList: (_host: string, filter: unknown) => {
        asked.push(filter);
        return Promise.resolve({ sessions: [], nextCursor: null });
      },
      formatDateTime: String,
      router: { push: () => {} },
    } as unknown as AppStore;
    const view = render(
      <HistoryList
        store={store}
        hostId="h"
        hostName="pc"
        density="comfortable"
        openId={null}
        onOpen={() => {}}
        initial={{ projectKey: "github.com/acme/repo", day: "2026-10-15" }}
      />,
    );
    await waitFor(() => expect(asked.length).toBeGreaterThan(0));
    expect(asked[0]).toMatchObject({
      projectKey: "github.com/acme/repo",
      from: "2026-10-15T00:00:00.000Z",
    });
    expect(view.container.textContent).toContain("Projeto: repo");
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Limpar projeto" }));
    });
    await waitFor(() => expect(asked.at(-1)).not.toHaveProperty("projectKey"));
    expect(asked.at(-1)).toMatchObject({ from: "2026-10-15T00:00:00.000Z" });
    expect(view.container.textContent).not.toContain("Projeto: repo");
  });
});
