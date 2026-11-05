import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { ResourcesSnapshot } from "@flightdeck/protocol";
import { formatBytes } from "../src/i18n/format.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { settle } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { HostResources } = await import("../src/components/hosts/host-resources.tsx");
const { TContext } = await import("../src/i18n/context.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

const MB = 1024 * 1024;
const GB = 1024 * MB;

const snapshot = (over: Partial<ResourcesSnapshot> = {}): ResourcesSnapshot => ({
  at: "2026-11-05T12:00:00.000Z",
  memory: { totalBytes: 8 * GB, freeBytes: 3 * GB },
  disk: { totalBytes: 100 * GB, freeBytes: 40 * GB },
  loadPercent: 35,
  measured: true,
  reason: null,
  rows: [
    {
      kind: "session",
      id: "s1",
      name: "Fix login",
      cwd: "/work/api",
      rssBytes: 300 * MB,
      cpuPercent: 12.5,
      processes: 3,
      names: ["claude", "bash", "bun"],
    },
    {
      kind: "terminal",
      id: "t1",
      name: "bash",
      cwd: "/work/web",
      rssBytes: 900 * MB,
      cpuPercent: null,
      processes: 2,
      names: ["bash", "node"],
    },
  ],
  orphans: [{ pid: 4242, name: "claude", rssBytes: 120 * MB, ageSec: 7200 }],
  ...over,
});

const host = {
  id: "h1",
  name: "pc",
  status: "online",
  hostInfo: { daemonVersion: "x", features: ["resources"] },
  sessions: [],
} as never;

function setup(
  options: { snap?: ResourcesSnapshot; language?: "en" | "pt-BR"; active?: boolean } = {},
) {
  const store = new AppStore(memoryPlatform(false, options.language ?? "en").platform, {
    baseDelayMs: 600_000,
  });
  store.i18n.start();
  const asked: Array<[string, unknown]> = [];
  let current = options.snap ?? snapshot();
  store.hostCommand = (async (_host: string, type: string, payload: unknown) => {
    asked.push([type, payload]);
    if (type === "resources.get") return current;
    if (type === "resources.endOrphan") return { ended: true };
    return {};
  }) as never;
  const view = (active = options.active ?? true) => (
    <TContext.Provider value={store.i18n.t}>
      <HostResources store={store} host={host} active={active} everyMs={20} />
    </TContext.Provider>
  );
  return {
    store,
    asked,
    view,
    set: (next: ResourcesSnapshot) => {
      current = next;
    },
  };
}

const reads = (asked: Array<[string, unknown]>) => asked.filter(([t]) => t === "resources.get");
const panel = (name = "Resources") => screen.getByRole("region", { name });

describe("recursos-ui: formatting sizes", () => {
  test("KB, MB and GB with the language's separators", () => {
    expect(formatBytes(512, "en")).toBe("512 B");
    expect(formatBytes(300 * MB, "en")).toBe("300 MB");
    expect(formatBytes(1.5 * GB, "en")).toBe("1.5 GB");
    expect(formatBytes(1.5 * GB, "pt-BR")).toBe("1,5 GB");
  });
});

describe("recursos-ui: the Resources panel of a host (issue #154)", () => {
  test("memory and disk as bars with the numbers in words, and the load", async () => {
    const w = setup();
    render(w.view());
    await settle(() => document.querySelector("[data-slot='resources-memory']") !== null);
    expect(
      within(panel()).getByText("63%").closest("[data-slot='resources-memory']"),
    ).not.toBeNull();
    expect(panel().textContent).toContain("5 GB of 8 GB used");
    expect(panel().textContent).toContain("60 GB of 100 GB used");
    expect(panel().textContent).toContain("Load 35%");
  });

  test("a table of sessions and terminals, the biggest memory first, with project, memory and CPU", async () => {
    const w = setup();
    render(w.view());
    await settle(() => document.querySelector("[data-slot='resources-row']") !== null);
    const rows = [...document.querySelectorAll("[data-slot='resources-row']")];
    expect(rows.map((r) => r.getAttribute("data-id"))).toEqual(["t1", "s1"]);
    const session = rows[1] as HTMLElement;
    expect(session.textContent).toContain("Fix login");
    expect(session.textContent).toContain("api");
    expect(session.textContent).toContain("300 MB");
    expect(session.textContent).toContain("12.5%");
    expect(session.textContent).toContain("claude, bash, bun");
    expect((rows[0] as HTMLElement).textContent).toContain("—");
  });

  test("it reads again while it is on screen and re-sorts, and stops when it is not", async () => {
    const w = setup();
    const view = render(w.view());
    await settle(() => reads(w.asked).length >= 2);
    w.set(
      snapshot({
        rows: snapshot().rows.map((row) => (row.id === "s1" ? { ...row, rssBytes: 2 * GB } : row)),
      }),
    );
    await settle(
      () => document.querySelector("[data-slot='resources-row']")?.getAttribute("data-id") === "s1",
    );
    view.rerender(w.view(false));
    const before = reads(w.asked).length;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 120));
    });
    expect(reads(w.asked).length).toBe(before);
    cleanup();
    const after = reads(w.asked).length;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 120));
    });
    expect(reads(w.asked).length).toBe(after);
  });

  test("a panel that is not on screen never asks", async () => {
    const w = setup({ active: false });
    render(w.view());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });
    expect(reads(w.asked)).toHaveLength(0);
  });

  test("memory at 80% and at 90% carries a warning in words, not only a colour", async () => {
    for (const [free, level, word] of [
      [3 * GB, "ok", null],
      [1.4 * GB, "high", "High"],
      [0.5 * GB, "critical", "Critical"],
    ] as const) {
      cleanup();
      const w = setup({ snap: snapshot({ memory: { totalBytes: 8 * GB, freeBytes: free } }) });
      render(w.view());
      await settle(() => document.querySelector("[data-slot='resources-memory']") !== null);
      const memory = document.querySelector("[data-slot='resources-memory']") as HTMLElement;
      expect(memory.getAttribute("data-level")).toBe(level);
      if (word) expect(memory.textContent).toContain(word);
      else expect(memory.textContent).not.toMatch(/High|Critical/);
    }
  });

  test("an orphan is listed with its pid, age and memory; ending it asks first and ends only that pid", async () => {
    const w = setup();
    render(w.view());
    await settle(() => document.querySelector("[data-slot='resources-orphan']") !== null);
    const orphan = document.querySelector("[data-slot='resources-orphan']") as HTMLElement;
    expect(orphan.textContent).toContain("4242");
    expect(orphan.textContent).toContain("claude");
    expect(orphan.textContent).toContain("120 MB");
    await act(async () => {
      fireEvent.click(within(orphan).getByRole("button", { name: "End" }));
    });
    expect(w.asked.some(([t]) => t === "resources.endOrphan")).toBe(false);
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain("4242");
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "End process" }));
    });
    await settle(() => w.asked.some(([t]) => t === "resources.endOrphan"));
    expect(w.asked.filter(([t]) => t === "resources.endOrphan")).toEqual([
      ["resources.endOrphan", { pid: 4242 }],
    ]);
  });

  test("cancelling the confirmation ends nothing", async () => {
    const w = setup();
    render(w.view());
    await settle(() => document.querySelector("[data-slot='resources-orphan']") !== null);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "End" }));
    });
    await act(async () => {
      fireEvent.click(
        within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel" }),
      );
    });
    expect(w.asked.some(([t]) => t === "resources.endOrphan")).toBe(false);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  test("a host that does not measure processes says why and still shows memory", async () => {
    const w = setup({
      snap: snapshot({ measured: false, reason: "platform", rows: [], orphans: [] }),
    });
    render(w.view());
    await settle(() => panel().textContent?.includes("not measured") === true);
    expect(panel().textContent).toContain("Processes are only measured on Linux hosts");
    expect(document.querySelector("[data-slot='resources-memory']")).not.toBeNull();
  });

  test("a host without the feature shows no panel, and an offline one does not ask", async () => {
    const w = setup();
    const noFeature = {
      ...(host as object),
      hostInfo: { daemonVersion: "x", features: [] },
    } as never;
    const { container } = render(
      <TContext.Provider value={w.store.i18n.t}>
        <HostResources store={w.store} host={noFeature} />
      </TContext.Provider>,
    );
    expect(container.textContent).toBe("");
    cleanup();
    const offline = { ...(host as object), status: "offline" } as never;
    render(
      <TContext.Provider value={w.store.i18n.t}>
        <HostResources store={w.store} host={offline} everyMs={20} />
      </TContext.Provider>,
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 80));
    });
    expect(reads(w.asked)).toHaveLength(0);
  });

  test("it reads in Portuguese", async () => {
    const w = setup({ language: "pt-BR" });
    render(w.view());
    await settle(() => document.querySelector("[data-slot='resources-memory']") !== null);
    expect(screen.getByRole("region", { name: "Recursos" })).toBeTruthy();
    expect(panel("Recursos").textContent).toContain("5 GB de 8 GB em uso");
    expect(panel("Recursos").textContent).toContain("12,5%");
  });
});
