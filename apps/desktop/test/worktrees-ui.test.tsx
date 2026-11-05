import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { WorktreeItem, WorktreesResult } from "@flightdeck/protocol";
import { formatBytes } from "../src/i18n/format.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { settle } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { HostWorktrees } = await import("../src/components/hosts/host-worktrees.tsx");
const { TContext } = await import("../src/i18n/context.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

const MB = 1024 * 1024;

const item = (name: string, over: Partial<WorktreeItem> = {}): WorktreeItem => ({
  projectId: "p1",
  projectName: "api",
  path: `/work/api/.flightdeck/worktrees/${name}`,
  branch: `fd/${name}`,
  cardId: null,
  cardTitle: null,
  column: null,
  prState: null,
  dirty: false,
  unpushed: 0,
  sizeBytes: 100 * MB,
  lastActivity: "2026-10-01T00:00:00.000Z",
  idleDays: 30,
  blockers: [],
  suggested: true,
  ...over,
});

const LIST: WorktreesResult = {
  worktrees: [
    item("merged", { cardId: "c1", cardTitle: "Fix login", column: "done", sizeBytes: 250 * MB }),
    item("dirty", { dirty: true, blockers: ["dirty"], suggested: false, sizeBytes: null }),
    item("ahead", { unpushed: 2, blockers: ["unpushed"], suggested: false }),
    item("live", { blockers: ["live_session"], suggested: false, cardId: "c2", cardTitle: "Docs" }),
    item("fresh", { idleDays: 1, suggested: false, sizeBytes: 10 * MB }),
  ],
  disks: [{ projectId: "p1", totalBytes: 1000 * MB, freeBytes: 400 * MB }],
};

const host = {
  id: "h1",
  name: "pc",
  status: "online",
  hostInfo: { daemonVersion: "x", features: ["worktrees"] },
  sessions: [],
} as never;

function setup(options: { list?: WorktreesResult; language?: "en" | "pt-BR" } = {}) {
  const store = new AppStore(memoryPlatform(false, options.language ?? "en").platform, {
    baseDelayMs: 600_000,
  });
  store.i18n.start();
  const asked: Array<[string, unknown]> = [];
  store.hostCommand = (async (_host: string, type: string, payload: unknown) => {
    asked.push([type, payload]);
    if (type === "worktree.list") return options.list ?? LIST;
    if (type === "worktree.remove") {
      const items = (payload as { items: Array<{ path: string }> }).items;
      return {
        removed: items.map((i) => ({ path: i.path, freedBytes: 250 * MB })),
        kept: [],
      };
    }
    return {};
  }) as never;
  const view = () => (
    <TContext.Provider value={store.i18n.t}>
      <HostWorktrees store={store} host={host} />
    </TContext.Provider>
  );
  return { store, asked, view };
}

const rows = () => [...document.querySelectorAll("[data-slot='worktree-row']")] as HTMLElement[];
const row = (name: string) => rows().find((r) => r.getAttribute("data-branch") === `fd/${name}`);
const box = (name: string) =>
  within(row(name) as HTMLElement).getByRole("checkbox") as HTMLInputElement;
const ready = () => settle(() => rows().length > 0);
const click = (el: Element) =>
  act(async () => {
    fireEvent.click(el);
  });

describe("worktrees-ui: sizes", () => {
  test("KB, MB and GB with the language's separators", () => {
    expect(formatBytes(512, "en")).toBe("512 B");
    expect(formatBytes(300 * MB, "en")).toBe("300 MB");
    expect(formatBytes(1.5 * 1024 * MB, "pt-BR")).toBe("1,5 GB");
  });
});

describe("worktrees-ui: the Worktrees panel (issue #152)", () => {
  test("every worktree is a row with its size ('unknown' when it could not be told), idle time and card", async () => {
    const w = setup();
    render(w.view());
    await ready();
    expect(rows()).toHaveLength(5);
    expect((row("merged") as HTMLElement).textContent).toContain("250 MB");
    expect((row("merged") as HTMLElement).textContent).toContain("Fix login");
    expect((row("merged") as HTMLElement).textContent).toContain("30 days idle");
    expect((row("dirty") as HTMLElement).textContent).toContain("unknown");
    expect(screen.getByRole("region", { name: "Worktrees" }).textContent).toContain("5 worktrees");
  });

  test("a protected one says why it is kept and cannot be ticked", async () => {
    const w = setup();
    render(w.view());
    await ready();
    expect((row("dirty") as HTMLElement).textContent).toContain(
      "Kept, because it has uncommitted changes",
    );
    expect((row("ahead") as HTMLElement).textContent).toContain(
      "Kept, because it has 2 commits that exist nowhere else",
    );
    expect((row("live") as HTMLElement).textContent).toContain(
      "Kept, because a session is running in it",
    );
    for (const name of ["dirty", "ahead", "live"]) expect(box(name).disabled).toBe(true);
    expect(box("merged").disabled).toBe(false);
    expect((row("merged") as HTMLElement).textContent).toContain("Suggested");
  });

  test("Select suggested ticks only the suggested ones, and Select all never reaches a protected row", async () => {
    const w = setup();
    render(w.view());
    await ready();
    await click(screen.getByRole("button", { name: "Select suggested" }));
    expect(["merged", "dirty", "ahead", "live", "fresh"].map((n) => box(n).checked)).toEqual([
      true,
      false,
      false,
      false,
      false,
    ]);
    await click(screen.getByRole("button", { name: "Select all that can go" }));
    expect(["merged", "dirty", "ahead", "live", "fresh"].map((n) => box(n).checked)).toEqual([
      true,
      false,
      false,
      false,
      true,
    ]);
  });

  test("the filters narrow the rows: Suggested, Protected and No card", async () => {
    const w = setup();
    render(w.view());
    await ready();
    const filter = async (name: string) => {
      await click(screen.getByRole("button", { name }));
      return rows().map((r) => r.getAttribute("data-branch"));
    };
    expect(await filter("Suggested")).toEqual(["fd/merged"]);
    expect(await filter("Protected")).toEqual(["fd/dirty", "fd/ahead", "fd/live"]);
    expect(await filter("No card")).toEqual(["fd/dirty", "fd/ahead", "fd/fresh"]);
    expect(await filter("All")).toHaveLength(5);
  });

  test("sorted by size, the biggest first, or by age", async () => {
    const w = setup();
    render(w.view());
    await ready();
    fireEvent.change(screen.getByLabelText("Sort by"), { target: { value: "size" } });
    expect(rows()[0]?.getAttribute("data-branch")).toBe("fd/merged");
    expect(rows().at(-1)?.getAttribute("data-branch")).toBe("fd/dirty");
  });

  test("removing asks first, naming each branch, and then sends exactly the ticked ones and says what was freed", async () => {
    const w = setup();
    render(w.view());
    await ready();
    expect(screen.getByRole("button", { name: /^Remove/ }).hasAttribute("disabled")).toBe(true);
    await click(box("merged"));
    await click(box("fresh"));
    await click(screen.getByRole("button", { name: "Remove 2 worktrees" }));
    expect(w.asked.some(([t]) => t === "worktree.remove")).toBe(false);
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain("fd/merged");
    expect(dialog.textContent).toContain("fd/fresh");
    expect(dialog.textContent).toContain("260 MB");
    await click(within(dialog).getByRole("button", { name: "Remove worktrees" }));
    await settle(() => w.asked.some(([t]) => t === "worktree.remove"));
    expect(w.asked.find(([t]) => t === "worktree.remove")?.[1]).toEqual({
      items: [
        { projectId: "p1", path: "/work/api/.flightdeck/worktrees/merged" },
        { projectId: "p1", path: "/work/api/.flightdeck/worktrees/fresh" },
      ],
    });
    await settle(() =>
      (screen.getByRole("region", { name: "Worktrees" }).textContent ?? "").includes(
        "Freed 500 MB",
      ),
    );
    // The list is read again after a removal.
    expect(w.asked.filter(([t]) => t === "worktree.list").length).toBeGreaterThanOrEqual(2);
  });

  test("a ticked row can be unticked, and Scan again reads the list once more", async () => {
    const w = setup();
    render(w.view());
    await ready();
    await click(box("merged"));
    expect(box("merged").checked).toBe(true);
    await click(box("merged"));
    expect(box("merged").checked).toBe(false);
    const before = w.asked.filter(([t]) => t === "worktree.list").length;
    await click(screen.getByRole("button", { name: "Scan again" }));
    await settle(() => w.asked.filter(([t]) => t === "worktree.list").length === before + 1);
  });

  test("cancelling the confirmation removes nothing", async () => {
    const w = setup();
    render(w.view());
    await ready();
    await click(box("merged"));
    await click(screen.getByRole("button", { name: "Remove 1 worktree" }));
    await click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel" }));
    expect(w.asked.some(([t]) => t === "worktree.remove")).toBe(false);
  });

  test("what the host kept is listed with its reason", async () => {
    const w = setup();
    w.store.hostCommand = (async (_h: string, type: string) => {
      if (type === "worktree.list") return LIST;
      return {
        removed: [],
        kept: [{ path: "/work/api/.flightdeck/worktrees/merged", reason: "dirty" }],
      };
    }) as never;
    render(w.view());
    await ready();
    await click(box("merged"));
    await click(screen.getByRole("button", { name: "Remove 1 worktree" }));
    await click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Remove worktrees" }),
    );
    await settle(() =>
      (screen.getByRole("region", { name: "Worktrees" }).textContent ?? "").includes(
        "Kept: fd/merged",
      ),
    );
    expect(screen.getByRole("region", { name: "Worktrees" }).textContent).toContain(
      "it has uncommitted changes",
    );
  });

  test("a disk under 10% free is warned about in words", async () => {
    const w = setup({
      list: { ...LIST, disks: [{ projectId: "p1", totalBytes: 1000 * MB, freeBytes: 50 * MB }] },
    });
    render(w.view());
    await ready();
    expect(screen.getByRole("region", { name: "Worktrees" }).textContent).toContain(
      "Free disk space is under 10%",
    );
  });

  test("a host without the feature shows nothing and an offline one is not asked", async () => {
    const w = setup();
    const none = { ...(host as object), hostInfo: { daemonVersion: "x", features: [] } } as never;
    const { container } = render(
      <TContext.Provider value={w.store.i18n.t}>
        <HostWorktrees store={w.store} host={none} />
      </TContext.Provider>,
    );
    expect(container.textContent).toBe("");
    cleanup();
    const off = { ...(host as object), status: "offline" } as never;
    render(
      <TContext.Provider value={w.store.i18n.t}>
        <HostWorktrees store={w.store} host={off} />
      </TContext.Provider>,
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });
    expect(w.asked).toEqual([]);
  });

  test("it reads in Portuguese", async () => {
    const w = setup({ language: "pt-BR" });
    render(w.view());
    await settle(() => rows().length > 0);
    expect(screen.getByRole("region", { name: "Worktrees" })).toBeTruthy();
    expect((row("dirty") as HTMLElement).textContent).toContain(
      "Mantida porque tem alterações não commitadas",
    );
    expect((row("merged") as HTMLElement).textContent).toContain("30 dias parada");
  });
});
