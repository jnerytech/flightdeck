import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { DepResult, DepsResult, DoctorResult } from "@flightdeck/protocol";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { HostHealth } = await import("../src/components/hosts/host-health.tsx");
const { TooltipProvider } = await import("../src/components/ui/tooltip.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

const NOW = Date.parse("2026-11-04T12:00:00.000Z");

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

const DEPS: DepsResult = {
  items: [
    dep("claude", "required", "ok"),
    dep("folders", "required", "missing", { breaks: ["sessions"] }),
    dep("service", "required", "missing", {
      breaks: ["autostart"],
      fix: [{ os: "linux", command: "sudo loginctl enable-linger $USER" }],
    }),
    dep("hooks", "optional", "outdated", { breaks: ["liveStatus"] }),
  ],
};

const DOCTOR: DoctorResult = {
  ok: false,
  checks: [
    { id: "claude", status: "ok", detail: "/usr/bin/claude" },
    { id: "hooks", status: "warn", detail: "outdated", fix: "x" },
    { id: "tailscale", status: "warn", detail: "Tailscale is up", fix: "run: flightdeckd setup" },
    { id: "version", status: "fail", detail: "daemon 0.35.0, app 0.36.0", fix: "update" },
    { id: "daemon", status: "ok", detail: "answering" },
  ],
};

function setup(
  options: { update?: string; checkedAt?: number | null; deps?: DepsResult | null } = {},
) {
  const store = new AppStore(memoryPlatform(false, "en").platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  store.now = () => NOW;
  const calls: string[] = [];
  store.hostCommand = (async (_host: string, type: string) => {
    calls.push(type);
    return { status: "installed", settingsPath: "~/.claude/settings.json" };
  }) as never;
  store.updateDaemon = (async () => {
    calls.push("updateDaemon");
  }) as never;
  const host = {
    id: "h1",
    name: "pc",
    hostInfo: {
      os: "linux",
      daemonVersion: "0.35.0",
      features: ["doctor.run", "depsCheck"],
      ...(options.update
        ? {
            update: { available: true, version: options.update, checkedAt: "2026-11-04T11:00:00Z" },
          }
        : {}),
    },
  } as never;
  let checks = 0;
  const added: string[] = [];
  const view = (
    <TooltipProvider>
      <HostHealth
        store={store}
        host={host}
        deps={options.deps === undefined ? DEPS : options.deps}
        doctor={options.deps === null ? null : DOCTOR}
        checkedAt={options.checkedAt === undefined ? NOW - 3 * 60_000 : options.checkedAt}
        onCheck={async () => void checks++}
        onAddFolder={() => added.push("x")}
      />
    </TooltipProvider>
  );
  return { view, calls, checks: () => checks, added };
}

const section = () => screen.getByRole("region", { name: "Health & dependencies" });
const row = (name: string) => within(section()).getByRole("listitem", { name });

describe("host-health-ui: one section for the dependencies and the doctor", () => {
  test("Required, Optional and Checks in one section, with when it was read", () => {
    render(setup().view);
    const text = section().textContent ?? "";
    expect(text).toContain("Checked 3 min ago");
    for (const group of ["Required", "Optional", "Checks"]) {
      expect(within(section()).getByRole("list", { name: group })).not.toBeNull();
    }
    expect(text.indexOf("Required")).toBeLessThan(text.indexOf("Optional"));
    expect(text.indexOf("Optional")).toBeLessThan(text.indexOf("Checks"));
    expect(screen.queryByText("Check this host")).toBeNull();
  });

  test("the doctor's checks show an icon and a word like the dependencies, and are not listed twice", () => {
    render(setup().view);
    const icon = (name: string) =>
      row(name).querySelector("[data-slot='dep-icon']")?.getAttribute("data-icon");
    expect(row("Tailscale").textContent).toContain("Warning");
    expect(icon("Tailscale")).toBe("warning");
    expect(row("Version").textContent).toContain("Failed");
    expect(icon("Version")).toBe("cross");
    expect(row("Daemon").textContent).toContain("OK");
    expect(icon("Daemon")).toBe("check");
    // claude, hooks, the folders and the service are dependencies: said once, in their group.
    for (const name of [
      "Claude Code",
      "Allowed folders",
      "Start at boot (service)",
      "Claude Code hooks",
    ]) {
      expect(within(section()).getAllByRole("listitem", { name })).toHaveLength(1);
    }
  });

  test("the headline counts the required and the failing: here three", () => {
    render(setup().view);
    expect(within(section()).getByText("3 required missing")).not.toBeNull();
  });

  test("a hooks one asks first, then installs; a version one with an update offers it; a folder takes you to the folders", async () => {
    const { view, calls, added } = setup({ update: "0.36.0" });
    render(view);
    await act(
      async () =>
        void fireEvent.click(
          within(row("Claude Code hooks")).getByRole("button", { name: "Install hooks" }),
        ),
    );
    const dialog = screen.getByRole("alertdialog");
    expect(calls).toEqual([]);
    await act(
      async () =>
        void fireEvent.click(within(dialog).getByRole("button", { name: "Install hooks" })),
    );
    expect(calls).toContain("hooks.install");
    await act(
      async () =>
        void fireEvent.click(
          within(row("Version")).getByRole("button", { name: "Update daemon to 0.36.0" }),
        ),
    );
    await act(
      async () =>
        void fireEvent.click(
          within(screen.getByRole("alertdialog")).getByRole("button", { name: "Update daemon" }),
        ),
    );
    expect(calls).toContain("updateDaemon");
    await act(
      async () =>
        void fireEvent.click(
          within(row("Allowed folders")).getByRole("button", { name: "Add folder" }),
        ),
    );
    expect(added).toEqual(["x"]);
  });

  test("what needs sudo or an installer is only copied: no button runs it", () => {
    render(setup().view);
    const service = row("Start at boot (service)");
    expect(service.textContent).toContain("sudo loginctl enable-linger $USER");
    expect(
      within(service)
        .queryAllByRole("button")
        .map((b) => b.getAttribute("aria-label")),
    ).toEqual(["Copy the command for Start at boot (service)"]);
  });

  test("Check again reads it again; before the first read it says it is checking", async () => {
    const first = setup();
    render(first.view);
    await act(
      async () =>
        void fireEvent.click(within(section()).getByRole("button", { name: "Check again" })),
    );
    expect(first.checks()).toBe(1);
    cleanup();
    render(setup({ checkedAt: null, deps: null }).view);
    expect(section().textContent).toContain("Checking…");
  });

  test("a daemon newer than the app can report an id or a feature the app has no text for, and the section still renders (HD-M2)", () => {
    const future = {
      items: [
        dep("claude", "required", "ok"),
        dep("future" as never, "optional", "missing", { breaks: ["teleport" as never] }),
      ],
    } as DepsResult;
    render(setup({ deps: future }).view);
    // The row shows the raw id and the feature; nothing throws.
    expect(row("future").textContent).toContain("teleport");
    expect(row("Claude Code")).not.toBeNull();
  });
});
