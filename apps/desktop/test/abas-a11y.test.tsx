import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { type AxeViolation, blocking, describeViolation } from "../../../scripts/lib/axe.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

registerDom();
const { act, cleanup, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");
const axe = (await import("axe-core")).default;
const { contrastRatio } = await import("../src/lib/contrast.ts");

/** `--name: value;` declarations of the first `selector { … }` block of styles.css. */
function tokens(selector: string): Record<string, string> {
  const css = readFileSync(resolve(import.meta.dir, "../src/styles.css"), "utf8");
  const start = css.indexOf(`${selector} {`);
  const body = css.slice(start, css.indexOf("}", start));
  return Object.fromEntries(
    [...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1] as string, m[2] as string]),
  );
}

setDefaultTimeout(30_000);
afterEach(cleanup);

/** The rules the prints' axe failed on the tab bars: a tablist holds tabs only. */
async function violations(): Promise<string[]> {
  const result = await axe.run(document.body, {
    runOnly: ["aria-required-children", "aria-required-parent", "nested-interactive"],
  });
  return blocking(result.violations as AxeViolation[]).map((v) => describeViolation("abas", v));
}

describe("abas: acessibilidade da barra de abas", () => {
  test("a tab bar with pinned, active and other tabs holds only tabs in its tablist", async () => {
    const store = new AppStore(memoryPlatform(false, "pt-BR").platform);
    render(<App store={store} />);
    await act(async () => {
      store.tabs.open({ name: "needs-you" });
      store.tabs.open({ name: "costs" });
      store.tabs.pin(store.tabs.activeId, true);
    });
    expect(await violations()).toEqual([]);
  });

  test("a close button next to every tab, inside the tablist's presentation wrappers, is axe-clean", async () => {
    const store = new AppStore(memoryPlatform(false, "pt-BR").platform);
    render(<App store={store} />);
    await act(async () => {
      store.tabs.open({ name: "needs-you" });
      store.tabs.open({ name: "costs" });
    });
    expect(screen.queryAllByLabelText(/^Fechar aba /)).toHaveLength(3);
    expect(await violations()).toEqual([]);
  });

  test("so do both tab bars of a split window", async () => {
    const store = new AppStore(memoryPlatform(false, "pt-BR").platform);
    render(<App store={store} />);
    await act(async () => {
      store.tabs.open({ name: "needs-you" });
      store.workspace.toggleSplit();
    });
    expect(await violations()).toEqual([]);
  });

  test("the badges read at 4.5:1 or more in both themes: needs-you is the background's color on its own", async () => {
    for (const selector of [":root", ".dark"]) {
      const t = tokens(selector);
      expect(
        contrastRatio(t["--background"] ?? "", t["--status-needs-you"] ?? ""),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(t["--muted-foreground"] ?? "", t["--muted"] ?? ""),
      ).toBeGreaterThanOrEqual(4.5);
    }
    const store = new AppStore(memoryPlatform(false, "pt-BR").platform);
    render(<App store={store} />);
    await act(async () => {
      store.tabs.open({ name: "needs-you" });
      (store as unknown as { update(patch: object): void }).update({
        hosts: [
          {
            id: "h",
            name: "pc",
            status: "online",
            sessions: [
              {
                id: "s1",
                cwd: "/p",
                status: "idle",
                pendingPermissions: [
                  { requestId: "r", toolName: "Bash", createdAt: "2026-10-30T12:00:00Z" },
                ],
              },
            ],
          },
        ],
      });
    });
    const badge = document.querySelector('[data-badge="needs-you"]');
    expect(badge?.className).toContain("bg-status-needs-you");
    expect(badge?.className).toContain("text-background");
    expect(badge?.className).not.toContain("text-white");
  });
});
