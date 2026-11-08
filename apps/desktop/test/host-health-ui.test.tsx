import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
  options: {
    update?: string;
    checkedAt?: number | null;
    deps?: DepsResult | null;
    error?: string | null;
    lang?: "en" | "pt-BR";
    doctor?: DoctorResult;
    /** The host's features beyond doctor.run and depsCheck (#1200). */
    features?: string[];
    status?: string;
    /** What service.install answers (#1200). */
    service?: { startsAt: "boot" | "logon"; lingerOff: boolean; user: string };
  } = {},
) {
  const store = new AppStore(memoryPlatform(false, options.lang ?? "en").platform, {
    baseDelayMs: 600_000,
  });
  store.i18n.start();
  store.now = () => NOW;
  const calls: string[] = [];
  store.hostCommand = (async (_host: string, type: string) => {
    calls.push(type);
    if (type === "service.install") return options.service ?? null;
    return { status: "installed", settingsPath: "~/.claude/settings.json" };
  }) as never;
  store.updateDaemon = (async () => {
    calls.push("updateDaemon");
  }) as never;
  const host = {
    id: "h1",
    name: "pc",
    status: options.status ?? "online",
    hostInfo: {
      os: "linux",
      daemonVersion: "0.35.0",
      features: ["doctor.run", "depsCheck", ...(options.features ?? [])],
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
        doctor={options.deps === null ? null : (options.doctor ?? DOCTOR)}
        checkedAt={options.checkedAt === undefined ? NOW - 3 * 60_000 : options.checkedAt}
        error={options.error ?? null}
        onCheck={async () => void checks++}
        onAddFolder={() => added.push("x")}
        onHooksChanged={() => {}}
      />
    </TooltipProvider>
  );
  return { view, calls, checks: () => checks, added };
}

const section = () => screen.getByRole("region", { name: "Health & dependencies" });
/** A row by name; a folded one is reached by opening the fold first (#670). */
const row = (name: string) => {
  const fold = within(section()).queryByRole("button", { name: /with nothing to do/ });
  if (fold?.getAttribute("aria-expanded") === "false") fireEvent.click(fold);
  return within(section()).getByRole("listitem", { name });
};

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

  describe("Start at boot from the app (#1200)", () => {
    const missingService: DepsResult = {
      items: [
        dep("claude", "required", "ok"),
        dep("service", "required", "missing", {
          breaks: ["autostart"],
          fix: [{ os: "linux", command: "flightdeckd service install" }],
        }),
      ],
    };
    const turnOn = (name = "Turn it on") =>
      within(row("Start at boot (service)")).queryByRole("button", { name });

    test("a connected host that offers it gets Turn it on: it asks first, installs, checks again, and says when it starts", async () => {
      const { view, calls, checks } = setup({
        deps: missingService,
        features: ["serviceInstall"],
        service: { startsAt: "logon", lingerOff: false, user: "dev" },
      });
      render(view);
      const button = turnOn();
      expect(button !== null).toBe(true);
      await act(async () => void fireEvent.click(button as HTMLElement));
      const dialog = screen.queryByRole("alertdialog");
      expect(calls).toEqual([]);
      expect(dialog?.textContent ?? "").toContain("~/.config/systemd/user/flightdeckd.service");
      expect(dialog?.textContent ?? "").toContain("The daemon running now stays as it is.");
      const confirm = dialog ? within(dialog).queryByRole("button", { name: "Turn it on" }) : null;
      await act(async () => void (confirm && fireEvent.click(confirm)));
      expect(calls).toEqual(["service.install"]);
      expect(checks()).toBe(1);
      const note = within(section()).queryByRole("status", { name: "Start at boot" });
      expect(note?.textContent ?? "").toContain("flightdeckd starts at your next login");
      expect(note?.textContent ?? "").toContain("The daemon running now stays as it is.");
    });

    test("with linger off it says the service waits for a login and gives the line to copy; the app never runs sudo", async () => {
      const { view, calls } = setup({
        deps: missingService,
        features: ["serviceInstall"],
        service: { startsAt: "logon", lingerOff: true, user: "dev" },
      });
      render(view);
      const button = turnOn();
      expect(button !== null).toBe(true);
      await act(async () => void (button && fireEvent.click(button)));
      const dialog = screen.queryByRole("alertdialog");
      const confirm = dialog ? within(dialog).queryByRole("button", { name: "Turn it on" }) : null;
      await act(async () => void (confirm && fireEvent.click(confirm)));
      const note = within(section()).queryByRole("status", { name: "Start at boot" });
      expect(note?.textContent ?? "").toContain("sudo loginctl enable-linger dev");
      expect(note?.textContent ?? "").toContain("The app never runs sudo");
      expect(calls).toEqual(["service.install"]);
    });

    test("offline, without the feature, or when the fix is the linger line, only the command is offered", () => {
      for (const [name, options] of [
        ["offline", { deps: missingService, features: ["serviceInstall"], status: "offline" }],
        ["no feature", { deps: missingService }],
        ["linger line", { features: ["serviceInstall"] }],
      ] as const) {
        const { view } = setup(options);
        render(view);
        expect(`${name}: ${turnOn() === null}`).toBe(`${name}: true`);
        cleanup();
      }
    });

    test("it speaks Portuguese too", async () => {
      const { view } = setup({ deps: missingService, features: ["serviceInstall"], lang: "pt-BR" });
      render(view);
      const fold = within(screen.getByRole("region", { name: "Saúde e dependências" })).queryByRole(
        "listitem",
        { name: "Iniciar no boot (serviço)" },
      );
      expect(fold ? within(fold).queryByRole("button", { name: "Ligar" }) !== null : false).toBe(
        true,
      );
    });
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

  test("a read that failed says why and offers Check again, instead of staying on Checking… (HD-M3)", async () => {
    const fixture = setup({ deps: null, checkedAt: null, error: "host busy" });
    render(fixture.view);
    expect(section().textContent).toContain("Could not read the health: host busy");
    expect(section().textContent).not.toContain("Checking…");
    await act(
      async () => void fireEvent.click(screen.getByRole("button", { name: "Check again" })),
    );
    expect(fixture.checks()).toBe(1);
  });

  test("a fix with a note says it under the command, in both languages (#214)", () => {
    const withNotes: DepsResult = {
      items: [
        dep("claude", "required", "ok"),
        dep("service", "required", "missing", {
          fix: [{ os: "linux", note: "noSystemd" }],
        }),
        dep("ssh", "optional", "missing", {
          fix: [{ os: "linux", command: "sudo apt install openssh-client", note: "elevated" }],
        }),
      ],
    };
    render(setup({ deps: withNotes }).view);
    expect(row("Start at boot (service)").textContent).toContain(
      "This computer has no systemd, so flightdeckd cannot be installed as a service here. Start it at login with your system's own tools.",
    );
    expect(row("SSH").textContent).toContain(
      "Run it in an elevated PowerShell (Run as administrator).",
    );
    cleanup();
    render(setup({ deps: withNotes, lang: "pt-BR" }).view);
    const text = within(screen.getByRole("region", { name: "Saúde e dependências" })).getByRole(
      "list",
      { name: "Obrigatórias" },
    ).textContent;
    expect(text).toContain("Este computador não tem systemd");
    expect(screen.getByRole("region", { name: "Saúde e dependências" }).textContent).toContain(
      "Execute em um PowerShell elevado (Executar como administrador).",
    );
  });
});

describe("host-health-ui: a summary, the problems first, the rest folded (#640)", () => {
  test("one line counts the rows and holds Check again", () => {
    render(setup().view);
    const summary = section().querySelector("[data-slot='health-summary']");
    expect({
      text: summary?.textContent?.includes("OK: 2 · Warnings: 2 · Problems: 3") ?? false,
      check: summary
        ? within(summary as HTMLElement).queryAllByRole("button", { name: "Check again" }).length
        : 0,
    }).toEqual({ text: true, check: 1 });
  });

  test("the groups list only the rows with a problem, open", () => {
    render(setup().view);
    const names = (group: string) =>
      within(within(section()).getByRole("list", { name: group }))
        .queryAllByRole("listitem")
        .map((item) => item.getAttribute("aria-label"));
    expect({
      required: names("Required"),
      optional: names("Optional"),
      checks: names("Checks"),
    }).toEqual({
      required: ["Allowed folders", "Start at boot (service)"],
      optional: ["Claude Code hooks"],
      checks: ["Tailscale", "Version"],
    });
  });

  test("the rows that are fine are folded in one compact list, closed", () => {
    render(setup().view);
    const toggle = within(section()).queryByRole("button", { name: /checks with nothing to do/ });
    const closed = {
      expanded: toggle?.getAttribute("aria-expanded") ?? null,
      list: within(section()).queryByRole("list", { name: "Working" }) !== null,
    };
    if (toggle) fireEvent.click(toggle);
    const compact = within(section())
      .queryAllByRole("listitem")
      .filter((li) => li.getAttribute("data-slot") === "dep-compact")
      .map((li) => li.getAttribute("aria-label"));
    expect({ closed, compact }).toEqual({
      closed: { expanded: "false", list: false },
      compact: ["Claude Code", "Daemon"],
    });
  });
});

const css = readFileSync(join(import.meta.dir, "../src/styles.css"), "utf8");
const utility = (name: string) => {
  const at = css.indexOf(`@utility ${name} {`);
  return at < 0 ? "" : css.slice(at, css.indexOf("\n}", at));
};

describe("host-health-ui: the folded list reads as a table and opens from a real button (#670)", () => {
  test("the fold is a disclosure button with a chevron that says what it shows and what it hides", () => {
    render(setup().view);
    const toggle = within(section()).queryByRole("button", {
      name: "Show 2 checks with nothing to do",
    });
    const before = {
      expanded: toggle?.getAttribute("aria-expanded") ?? null,
      chevron: toggle?.querySelector("[data-slot='fold-chevron']") !== null,
    };
    if (toggle) fireEvent.click(toggle);
    const list = within(section()).queryByRole("list", { name: "Working" });
    expect({
      before,
      after: toggle?.getAttribute("aria-expanded") ?? null,
      text: toggle?.textContent ?? null,
      controls:
        toggle !== null && list !== null && toggle.getAttribute("aria-controls") === list.id,
    }).toEqual({
      before: { expanded: "false", chevron: true },
      after: "true",
      text: "Hide 2 checks with nothing to do",
      controls: true,
    });
  });

  test("in Portuguese it says Mostrar and Ocultar", () => {
    render(setup({ lang: "pt-BR" }).view);
    const region = screen.getByRole("region", { name: "Saúde e dependências" });
    const toggle = within(region).queryByRole("button", {
      name: "Mostrar 2 itens sem nada a fazer",
    });
    if (toggle) fireEvent.click(toggle);
    expect(toggle?.textContent ?? null).toBe("Ocultar 2 itens sem nada a fazer");
  });

  test("the rows share the list's columns, so every status starts at the same place", () => {
    // happy-dom does not lay out a grid: the list owns the columns and each row takes them as a
    // subgrid, so the icon, name, status and detail line up across rows.
    expect({
      list: /grid-template-columns:[^;]*max-content/.test(utility("dep-compact-list")),
      row: utility("dep-compact").includes("grid-template-columns: subgrid"),
      // A webview without subgrid (Chromium before 117) gets fixed columns instead.
      fallback:
        /@supports not \(grid-template-columns: subgrid\) \{\s*grid-template-columns: 1rem minmax\(0, 14rem\)/.test(
          utility("dep-compact"),
        ),
    }).toEqual({ list: true, row: true, fallback: true });
  });

  test("an optional tool that is not installed is muted, not a green OK, and not counted as OK", () => {
    const doctor: DoctorResult = {
      ...DOCTOR,
      checks: [
        ...DOCTOR.checks,
        {
          id: "opencode",
          status: "ok",
          detail: "OpenCode is not installed (optional)",
          absent: true,
        },
      ],
    };
    render(setup({ doctor }).view);
    const toggle = within(section()).queryByRole("button", { name: /checks with nothing to do/ });
    if (toggle) fireEvent.click(toggle);
    const item = within(section())
      .queryAllByRole("listitem")
      .find((li) => li.getAttribute("aria-label") === "OpenCode");
    const icon = item?.querySelector("[data-slot='dep-icon']");
    expect({
      text: item?.textContent?.includes("Optional · not installed") ?? false,
      okWord: item?.textContent?.includes("OK") ?? null,
      icon: icon?.getAttribute("data-icon") ?? null,
      green: icon?.getAttribute("class")?.includes("text-status-ok") ?? null,
      counts:
        section().querySelector("[data-slot='health-summary']")?.textContent?.includes("OK: 2 ·") ??
        false,
    }).toEqual({ text: true, okWord: false, icon: "dash", green: false, counts: true });
  });
});
