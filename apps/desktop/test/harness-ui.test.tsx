import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { ProjectLoad } from "@flightdeck/protocol";
import { registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { settle, stays, uiIdle } from "./wait.ts";

registerDom();
const { cleanup, render, screen } = await import("@testing-library/react");
const { AppStore } = await import("../src/lib/app-store.ts");
const { ProjectPage } = await import("../src/ui/ProjectPage.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

/** Issue #75, slice S1: the project page shows the project's Claude Code setup as a checklist. */
const LOAD: ProjectLoad = {
  path: "/work/api",
  hooks: [
    { event: "PostToolUse", file: ".claude/settings.json", commands: ["prettier --write ."] },
  ],
  mcpServers: [],
  envKeys: ["API_KEY"],
  allowRules: ["Bash(git:*)", "Bash(bun test:*)"],
  defaultMode: null,
  agents: ["reviewer"],
  skills: [],
  commands: [],
  claudeMd: true,
  executables: [],
  redirects: [],
  plugins: [],
  otherKeys: [],
  extras: [],
  unreadable: [],
  omitted: { hooks: 0, mcpServers: 0, allowRules: 0, envKeys: 0 },
};

function setup(
  options: { language?: "en" | "pt-BR"; features?: string[]; load?: ProjectLoad | null } = {},
) {
  const store = new AppStore(memoryPlatform(false, options.language ?? "en").platform, {
    baseDelayMs: 600_000,
  });
  store.i18n.start();
  store.loadProjects = (async () => []) as never;
  store.refreshHub = (async () => {}) as never;
  store.hostCommand = (async (_host: string, type: string) => {
    if (type === "project.trust.state")
      return { items: [{ path: "/work/api", trusted: false, via: null }] };
    if (type === "project.trust.inspect") return options.load === undefined ? LOAD : options.load;
    return null;
  }) as never;
  const appState = {
    ...store.getState(),
    hosts: [
      {
        id: "h1",
        name: "alfa",
        status: "online",
        hostInfo: { daemonVersion: "x", features: options.features ?? ["projectTrust"] },
        sessions: [],
      },
    ],
    projects: { h1: [{ id: "p1", name: "api", path: "/work/api", baseBranch: "main" }] },
  } as never as ReturnType<typeof store.getState>;
  return <ProjectPage store={store} state={appState} hostId="h1" projectId="p1" go={() => {}} />;
}

/** A part's row: its name and whether it is found, as the card says it. */
const row = (name: string) =>
  screen.queryByRole("listitem", { name })?.textContent ?? "missing row";

describe("harness-ui: the project's Claude Code setup as a checklist (#75)", () => {
  test("each part says found or missing, with what shows it, and how many of the six are there", async () => {
    render(setup());
    // The trust panel reads the same listing: once it shows, the card has its data too.
    await settle(
      () => screen.queryByText("What this project would load") !== null,
      5000,
      "the listing",
    );
    await uiIdle();
    expect([
      screen.queryByText("4 of 6 parts found") !== null,
      screen.queryByRole("region", { name: "Claude Code setup" }) !== null,
      row("CLAUDE.md").includes("Found"),
      row("Hooks").includes("formatter after edits"),
      row("Skills").includes("Missing"),
      row("Subagents").includes("reviewer"),
      row("Permissions").includes("Allow rules: 2; deny rules: 0"),
      row("MCP servers").includes("Missing"),
      // Names of environment variables are for the trust panel, never this card.
      (screen.queryByRole("region", { name: "Claude Code setup" })?.textContent ?? "").includes(
        "API_KEY",
      ),
    ]).toEqual([true, true, true, true, true, true, true, true, false]);
  });

  test("in Portuguese too", async () => {
    render(setup({ language: "pt-BR" }));
    await settle(
      () => screen.queryByText("O que este projeto carregaria") !== null,
      5000,
      "the listing in Portuguese",
    );
    await uiIdle();
    expect([
      screen.queryByText("4 de 6 partes encontradas") !== null,
      screen.queryByRole("region", { name: "Configuração do Claude Code" }) !== null,
      row("Skills").includes("Faltando"),
    ]).toEqual([true, true, true]);
  });

  test("a host that does not list a project's setup shows no card", async () => {
    render(setup({ features: [] }));
    await stays(() => screen.queryByRole("region", { name: "Claude Code setup" }) === null);
    expect(screen.queryByText("4 of 6 parts found")).toBeNull();
  });

  test("a listing the host refuses shows no card; one with unreadable files says parts may be missing", async () => {
    render(setup({ load: null }));
    await settle(
      () => screen.queryByText("Project configuration") !== null,
      5000,
      "the trust panel",
    );
    await uiIdle();
    const refused = screen.queryByRole("region", { name: "Claude Code setup" }) === null;
    cleanup();
    render(setup({ load: { ...LOAD, unreadable: [".claude/settings.json"] } }));
    await settle(
      () => screen.queryByText("What this project would load") !== null,
      5000,
      "the listing",
    );
    await uiIdle();
    expect([
      refused,
      screen.queryByText(
        "Some of the project's files could not be read: a part shown as missing may be there.",
      ) !== null,
    ]).toEqual([true, true]);
  });
});
