import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { ProjectLoad, ProjectTrustState } from "@flightdeck/protocol";
import { registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, screen, waitFor, within } = await import(
  "@testing-library/react"
);
const { AppStore } = await import("../src/lib/app-store.ts");
const { ProjectPage } = await import("../src/ui/ProjectPage.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

const LOAD: ProjectLoad = {
  path: "/work/api",
  hooks: [{ event: "SessionStart", file: ".claude/settings.json", commands: ["./setup.sh"] }],
  mcpServers: [{ name: "db", file: ".mcp.json", command: "node server.js" }],
  envKeys: ["API_KEY"],
  allowRules: ["Bash(git:*)"],
  defaultMode: null,
  agents: ["reviewer"],
  skills: ["deploy"],
  commands: ["ship"],
  claudeMd: true,
  unreadable: [".claude/settings.local.json"],
  omitted: { hooks: 0, mcpServers: 0, allowRules: 0, envKeys: 0 },
};

function setup(
  options: {
    language?: "en" | "pt-BR";
    features?: string[];
    state?: ProjectTrustState;
    load?: ProjectLoad;
    fail?: boolean;
  } = {},
) {
  const store = new AppStore(memoryPlatform(false, options.language ?? "en").platform, {
    baseDelayMs: 600_000,
  });
  store.i18n.start();
  store.loadProjects = (async () => []) as never;
  store.refreshHub = (async () => {}) as never;
  let state: ProjectTrustState = options.state ?? { path: "/work/api", trusted: false, via: null };
  const sent: Array<[string, unknown]> = [];
  store.hostCommand = (async (_host: string, type: string, payload: unknown) => {
    sent.push([type, payload]);
    if (options.fail) return null;
    if (type === "project.trust.state") return { items: [state] };
    if (type === "project.trust.inspect") return options.load ?? LOAD;
    if (type === "project.trust.set") {
      const { trusted, path } = payload as { trusted: boolean; path: string };
      state = trusted ? { path, trusted: true, via: path } : { path, trusted: false, via: null };
      return state;
    }
    return null;
  }) as never;
  const appState = {
    ...store.getState(),
    hosts: [
      {
        id: "h1",
        name: "alfa",
        status: "online",
        hostInfo: {
          daemonVersion: "x",
          features: options.features ?? ["projectTrust"],
        },
        sessions: [],
      },
    ],
    projects: { h1: [{ id: "p1", name: "api", path: "/work/api", baseBranch: "main" }] },
  } as never as ReturnType<typeof store.getState>;
  const view = (
    <ProjectPage store={store} state={appState} hostId="h1" projectId="p1" go={() => {}} />
  );
  return { view, sent };
}

describe("trust-ui: the project page says what a project would load and lets the person decide (#196)", () => {
  test("an untrusted project shows what it would load, in words, and what not trusting costs", async () => {
    render(setup().view);
    await waitFor(() => expect(screen.queryByText("What this project would load")).not.toBeNull());
    expect(
      screen.queryByText("Not trusted. Sessions here load your own settings, not this project's."),
    ).not.toBeNull();
    expect(
      screen.queryByText(
        /Until you trust it, this project's hooks, MCP servers, settings, CLAUDE.md, agents and skills do not load, and neither do your own MCP servers and plugins/,
      ),
    ).not.toBeNull();
    const panel = screen.getByRole("region", { name: "Project configuration" });
    const text = panel.textContent ?? "";
    for (const part of [
      "SessionStart",
      "./setup.sh",
      "db",
      "node server.js",
      "API_KEY",
      "Bash(git:*)",
      "reviewer",
      "deploy",
      "ship",
      "CLAUDE.md",
      ".claude/settings.local.json",
    ]) {
      expect([part, text.includes(part)]).toEqual([part, true]);
    }
  });

  test("trusting asks first, naming the project and the host, then sends the decision and shows it", async () => {
    const { view, sent } = setup();
    render(view);
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Trust this project" })).not.toBeNull(),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Trust this project" }));
    });
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain("api");
    expect(dialog.textContent).toContain("alfa");
    expect(sent.some(([type]) => type === "project.trust.set")).toBe(false);
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Trust this project" }));
    });
    await waitFor(() =>
      expect(
        screen.queryByText("Trusted: this project's own configuration loads in its sessions."),
      ).not.toBeNull(),
    );
    expect(sent.find(([type]) => type === "project.trust.set")?.[1]).toEqual({
      path: "/work/api",
      trusted: true,
    });
  });

  test("a project trusted through a parent folder says so, and revoking goes through that folder without asking", async () => {
    const { view, sent } = setup({ state: { path: "/work/api", trusted: true, via: "/work" } });
    render(view);
    await waitFor(() => expect(screen.queryByText(/Trusted through \/work/)).not.toBeNull());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Revoke trust" }));
    });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await waitFor(() => expect(sent.some(([type]) => type === "project.trust.set")).toBe(true));
    expect(sent.find(([type]) => type === "project.trust.set")?.[1]).toEqual({
      path: "/work",
      trusted: false,
    });
  });

  test("a list the daemon capped says how many entries are not shown, so the person never trusts on a partial list", async () => {
    render(
      setup({
        load: { ...LOAD, omitted: { hooks: 30, mcpServers: 50, allowRules: 0, envKeys: 0 } },
      }).view,
    );
    await waitFor(() => expect(screen.queryByText("+30 more not shown")).not.toBeNull());
    expect(screen.queryByText("+50 more not shown")).not.toBeNull();
    expect(screen.queryByText("+0 more not shown")).toBeNull();
  });

  test("a project with nothing of its own says so", async () => {
    render(
      setup({
        load: {
          ...LOAD,
          hooks: [],
          mcpServers: [],
          envKeys: [],
          allowRules: [],
          agents: [],
          skills: [],
          commands: [],
          claudeMd: false,
          unreadable: [],
        },
      }).view,
    );
    await waitFor(() =>
      expect(
        screen.queryByText("Nothing: this project brings no configuration of its own."),
      ).not.toBeNull(),
    );
  });

  test("a host that does not announce projectTrust shows no panel, and a failed read says so", async () => {
    const none = render(setup({ features: ["costs"] }).view);
    await waitFor(() => expect(none.queryByRole("heading", { name: "api" })).not.toBeNull());
    expect(none.queryByRole("region", { name: "Project configuration" })).toBeNull();
    cleanup();
    render(setup({ fail: true }).view);
    await waitFor(() =>
      expect(screen.queryByText("Could not read this project's configuration.")).not.toBeNull(),
    );
  });

  test("in Portuguese too", async () => {
    render(setup({ language: "pt-BR" }).view);
    await waitFor(() => expect(screen.queryByText("O que este projeto carregaria")).not.toBeNull());
    expect(
      screen.queryByText(
        "Sem confiança. As sessões aqui carregam as suas configurações, não as deste projeto.",
      ),
    ).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Confiar neste projeto" })).not.toBeNull();
  });
});
