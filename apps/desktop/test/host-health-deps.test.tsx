import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { DepResult, DepsResult } from "@flightdeck/protocol";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, waitFor as pollFor, TOKEN } from "./fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");
const { HostHealth } = await import("../src/components/hosts/host-health.tsx");
const { TooltipProvider } = await import("../src/components/ui/tooltip.tsx");

setDefaultTimeout(30_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const dep = (
  id: DepResult["id"],
  group: DepResult["group"],
  state: DepResult["state"],
  extra: Partial<DepResult> = {},
): DepResult => ({
  id,
  group,
  state,
  breaks: [],
  fix: [{ os: "linux", command: `sudo apt install ${id}` }],
  ...extra,
});

const MISSING_REQUIRED: DepsResult = {
  items: [
    dep("claude", "required", "ok", { version: "2.1.0", path: "/usr/bin/claude" }),
    dep("git", "required", "outdated", {
      version: "2.3.1",
      minVersion: "2.5.0",
      path: "/usr/bin/git",
      breaks: ["projects", "worktrees"],
    }),
    dep("service", "required", "missing", { breaks: ["autostart"] }),
    dep("gh", "optional", "missing", { breaks: ["github", "pullRequests"] }),
    dep("pwsh", "optional", "na"),
  ],
};

function setup(deps: DepsResult | null) {
  const store = new AppStore(memoryPlatform(false, "en").platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  const copied: string[] = [];
  store.copyText = (async (text: string) => {
    copied.push(text);
    return true;
  }) as never;
  let checks = 0;
  const view = (
    <TooltipProvider>
      <HostHealth
        store={store}
        host={{ id: "h1", name: "pc", hostInfo: { os: "linux", features: [] } } as never}
        deps={deps}
        doctor={null}
        checkedAt={null}
        onCheck={async () => void checks++}
        onAddFolder={() => {}}
      />
    </TooltipProvider>
  );
  return { view, copied, store, checks: () => checks };
}

describe("deps-ui: the dependencies of a host", () => {
  test("a headline, a Required and an Optional group, each row with an icon and its state in words", () => {
    const { view } = setup(MISSING_REQUIRED);
    render(view);
    const section = screen.getByRole("region", { name: "Health & dependencies" });
    expect(within(section).getByText("2 required missing")).not.toBeNull();
    const required = within(section).getByRole("list", { name: "Required" });
    expect(within(required).getAllByRole("listitem")).toHaveLength(3);
    const optional = within(section).getByRole("list", { name: "Optional" });
    expect(within(optional).getAllByRole("listitem")).toHaveLength(2);
    const row = (name: string) => within(section).getByRole("listitem", { name });
    expect(row("Claude Code").textContent).toContain("OK");
    expect(row("Git").textContent).toContain("Outdated");
    expect(row("Start at boot (service)").textContent).toContain("Missing");
    expect(row("PowerShell").textContent).toContain("Not applicable");
    // The icon says it too, never the color alone.
    const icon = (name: string) => row(name).querySelector("[data-slot='dep-icon']");
    expect(icon("Claude Code")?.getAttribute("data-icon")).toBe("check");
    expect(icon("Git")?.getAttribute("data-icon")).toBe("warning");
    expect(icon("Start at boot (service)")?.getAttribute("data-icon")).toBe("cross");
    expect(icon("PowerShell")?.getAttribute("data-icon")).toBe("dash");
  });

  test("a row says the version found and the least one, what breaks without it, and the fix to copy", async () => {
    const { view, copied } = setup(MISSING_REQUIRED);
    render(view);
    const git = screen.getByRole("listitem", { name: "Git" });
    expect(git.textContent).toContain("2.3.1");
    expect(git.textContent).toContain("at least 2.5.0");
    expect(git.textContent).toContain("/usr/bin/git");
    expect(git.textContent).toContain("Without it:");
    expect(git.textContent).toContain("projects");
    expect(git.textContent).toContain("sudo apt install git");
    await act(
      async () =>
        void fireEvent.click(within(git).getByRole("button", { name: "Copy the command for Git" })),
    );
    expect(copied).toEqual(["sudo apt install git"]);
  });

  test("a program with no one-line install offers only its install page, which opens in the browser", async () => {
    const { view, store } = setup({
      items: [
        dep("az", "optional", "missing", {
          breaks: ["azure"],
          fix: [
            { os: "linux", url: "https://learn.microsoft.com/cli/azure/install-azure-cli-linux" },
          ],
        }),
        dep("gh", "optional", "missing", {
          fix: [{ os: "linux", command: "sudo apt install gh", url: "https://cli.github.com" }],
        }),
      ],
    });
    const opened: string[] = [];
    store.openLink = (url: string) => void opened.push(url);
    render(view);
    const az = screen.getByRole("listitem", { name: "Azure CLI (az)" });
    expect(within(az).queryByRole("button", { name: /Copy the command/ })).toBeNull();
    await act(
      async () =>
        void fireEvent.click(
          within(az).getByRole("button", { name: "Open the install page for Azure CLI (az)" }),
        ),
    );
    const gh = screen.getByRole("listitem", { name: "GitHub CLI (gh)" });
    expect(
      within(gh).getByRole("button", { name: "Copy the command for GitHub CLI (gh)" }),
    ).not.toBeNull();
    await act(
      async () =>
        void fireEvent.click(
          within(gh).getByRole("button", { name: "Open the install page for GitHub CLI (gh)" }),
        ),
    );
    expect(opened).toEqual([
      "https://learn.microsoft.com/cli/azure/install-azure-cli-linux",
      "https://cli.github.com",
    ]);
  });

  test("everything in place says All set; Check again asks the host again", async () => {
    const all = setup({ items: [dep("claude", "required", "ok"), dep("pwsh", "optional", "na")] });
    render(all.view);
    expect(screen.getByText("All set")).not.toBeNull();
    expect(screen.queryByRole("button", { name: /Copy the command/ })).toBeNull();
    await act(
      async () => void fireEvent.click(screen.getByRole("button", { name: "Check again" })),
    );
    expect(all.checks()).toBe(1);
  });

  test("optional ones missing say how many, in amber words", () => {
    const { view } = setup({
      items: [dep("claude", "required", "ok"), dep("gh", "optional", "missing")],
    });
    render(view);
    expect(screen.getByText("1 optional missing")).not.toBeNull();
  });
});

describe("deps-ui: on the host page and the sidebar", () => {
  const depsOf = (gh: DepResult["state"], git: DepResult["state"]): DepsResult => ({
    items: [
      dep("claude", "required", "ok"),
      dep("git", "required", git, { breaks: ["projects"] }),
      dep("gh", "optional", gh, { breaks: ["github"] }),
    ],
  });

  test("the Overview tab shows the section, a required one missing puts a badge on the host in the sidebar, and Check again updates both", async () => {
    let current = depsOf("missing", "missing");
    const d = makeDaemon(cleanups, { deps: () => current });
    const server = d.listen();
    const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
    cleanups.push(() => store.dispose());
    render(<App store={store} />);
    await act(async () => {
      await store.addHost({ name: "pc", url: server.url, token: TOKEN });
    });
    await pollFor(() => store.getState().hosts[0]?.status === "online" || undefined, "online");
    await act(
      async () => void fireEvent.click(screen.getByRole("button", { name: "Abrir host pc" })),
    );
    const section = await pollFor(
      () => screen.queryByRole("region", { name: "Saúde e dependências" }) ?? undefined,
      "the section",
    );
    await pollFor(
      () => (section.textContent ?? "").includes("Obrigatórias faltando: 1") || undefined,
      "the headline",
    );
    expect(screen.queryByLabelText("pc: uma dependência obrigatória falta")).not.toBeNull();
    current = depsOf("ok", "ok");
    await act(
      async () =>
        void fireEvent.click(within(section).getByRole("button", { name: "Verificar de novo" })),
    );
    await pollFor(() => (section.textContent ?? "").includes("Tudo certo") || undefined, "all set");
    expect(screen.queryByLabelText("pc: uma dependência obrigatória falta")).toBeNull();
  });
});
