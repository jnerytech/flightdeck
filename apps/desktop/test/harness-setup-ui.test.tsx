import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { HarnessPreview, ProjectLoad } from "@flightdeck/protocol";
import { registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { settle, settleMaybe, uiIdle } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, screen, within } = await import("@testing-library/react");
const { AppStore } = await import("../src/lib/app-store.ts");
const { ProjectPage } = await import("../src/ui/ProjectPage.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

/**
 * Issue #75, slice S4b: the project page sets up what the preview proposes, after the person read
 * it. The app sends back the digests of the preview it showed, never content.
 */
const LOAD: ProjectLoad = {
  path: "/work/api",
  hooks: [],
  mcpServers: [],
  envKeys: [],
  allowRules: [],
  defaultMode: null,
  agents: [],
  skills: [],
  commands: [],
  claudeMd: false,
  executables: [],
  redirects: [],
  plugins: [],
  otherKeys: [],
  extras: [],
  unreadable: [],
  omitted: { hooks: 0, mcpServers: 0, allowRules: 0, envKeys: 0 },
};
const ALL = ["claudeMd", "hooks", "skills", "agents", "permissions"];
const SETTINGS = ".claude/settings.json";
const PROPOSAL: NonNullable<HarnessPreview["settings"]> = {
  path: SETTINGS,
  hash: null,
  hooks: [{ event: "PostToolUse", matcher: "Edit|MultiEdit|Write", command: "bun run format" }],
  denyRules: ["Read(./.env)", "Bash(git add -A:*)"],
  conflicts: ["hooks.PreToolUse"],
  reformats: false,
  digest: "d-settings",
};
const PREVIEW: HarnessPreview = {
  settings: PROPOSAL,
  files: [{ path: "CLAUDE.md", content: "# Project notes\n", digest: "d-claude" }],
  unreadable: [".claude/skills/tdd/SKILL.md"],
};
const FEATURES = ["projectTrust", "harnessPreview", "harnessApply"];
type Answer =
  | { ok: true; data: unknown }
  | { ok: false; code: string; message: string; reason?: string };

function setup(
  options: {
    language?: "en" | "pt-BR";
    features?: string[];
    trusted?: boolean;
    preview?: HarnessPreview;
    answers?: Answer[];
  } = {},
) {
  const store = new AppStore(memoryPlatform(false, options.language ?? "en").platform, {
    baseDelayMs: 600_000,
  });
  store.i18n.start();
  store.loadProjects = (async () => []) as never;
  store.refreshHub = (async () => {}) as never;
  const sent: Array<[string, unknown]> = [];
  const answers = [
    ...(options.answers ?? [{ ok: true, data: { written: [SETTINGS, "CLAUDE.md"] } }]),
  ];
  store.hostCommand = (async (_host: string, type: string, payload: unknown) => {
    sent.push([type, payload]);
    if (type === "project.trust.state") {
      return { items: [{ path: "/work/api", trusted: options.trusted ?? false, via: null }] };
    }
    if (type === "project.trust.inspect") return LOAD;
    if (type === "project.harness.preview") return options.preview ?? PREVIEW;
    return null;
  }) as never;
  store.hostRequest = (async (_host: string, type: string, payload: unknown) => {
    sent.push([type, payload]);
    return answers.shift() ?? { ok: false, code: "invalid_state", message: "no answer" };
  }) as never;
  const appState = {
    ...store.getState(),
    hosts: [
      {
        id: "h1",
        name: "alfa",
        status: "online",
        hostInfo: { daemonVersion: "x", features: options.features ?? FEATURES },
        sessions: [],
      },
    ],
    projects: { h1: [{ id: "p1", name: "api", path: "/work/api", baseBranch: "main" }] },
  } as never as ReturnType<typeof store.getState>;
  const view = (
    <ProjectPage store={store} state={appState} hostId="h1" projectId="p1" go={() => {}} />
  );
  const count = (type: string) => sent.filter(([sentType]) => sentType === type).length;
  return { view, sent, count };
}

const listing = (text = "What this project would load") =>
  settle(() => screen.queryByText(text) !== null, 5000, "the listing");
const button = (name: string) => screen.queryByRole("button", { name });
const dialogText = () => screen.queryByRole("alertdialog")?.textContent ?? "";
async function click(name: string | RegExp, inDialog = false) {
  const scope = inDialog ? screen.queryByRole("alertdialog") : document.body;
  const target = scope ? within(scope as HTMLElement).queryByRole("button", { name }) : null;
  if (target) await act(async () => fireEvent.click(target));
  return target !== null;
}
/** Opens the setup's dialog: true when the button was there and the dialog showed. */
async function open() {
  const shown = await settleMaybe(() => button("Set up Claude Code") !== null);
  if (!shown) return false;
  await click("Set up Claude Code");
  return settleMaybe(() => screen.queryByRole("alertdialog") !== null);
}

describe("harness-setup-ui: the project page sets up Claude Code after the person read the preview (#75)", () => {
  test("only a host that can preview and apply offers it", async () => {
    const both = setup();
    render(both.view);
    await listing();
    const offered = await settleMaybe(() => button("Set up Claude Code") !== null);
    cleanup();
    const older = setup({ features: ["projectTrust", "harnessPreview"] });
    render(older.view);
    await listing();
    await uiIdle();
    expect([offered, button("Set up Claude Code") !== null]).toEqual([true, false]);
  });

  test("the dialog says what would be added, with the formatter's and the deny rules' caveats", async () => {
    const { view, sent } = setup();
    render(view);
    await listing();
    const opened = await open();
    const text = dialogText();
    expect([
      opened,
      sent.find(([type]) => type === "project.harness.preview")?.[1],
      text.includes("bun run format"),
      text.includes("a pull can change it"),
      text.includes("Read(./.env)"),
      text.includes("They do not stop a shell command"),
      text.includes("CLAUDE.md"),
      text.includes("hooks.PreToolUse"),
      text.includes(".claude/skills/tdd/SKILL.md"),
      text.includes("only once you trust this project"),
    ]).toEqual([
      true,
      { path: "/work/api", parts: ALL },
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
    ]);
  });

  test("Apply sends the shown preview's digests with confirm, then reads the project again", async () => {
    const { view, sent, count } = setup({ trusted: true });
    render(view);
    await listing();
    const opened = await open();
    const trustNote = dialogText().includes("only once you trust this project");
    const reads = count("project.trust.inspect");
    const applied = await click("Apply the setup", true);
    const done = await settleMaybe(
      () => screen.queryByText(`Set up: ${SETTINGS}, CLAUDE.md`) !== null,
    );
    expect([
      opened,
      trustNote,
      applied,
      sent.find(([type]) => type === "project.harness.apply")?.[1],
      done,
      count("project.trust.inspect") > reads,
    ]).toEqual([
      true,
      false,
      true,
      {
        path: "/work/api",
        parts: ALL,
        digests: { [SETTINGS]: "d-settings", "CLAUDE.md": "d-claude" },
        confirm: true,
      },
      true,
      true,
    ]);
  });

  test("settings that would be reformatted need a tick: Apply stays off until then, and sends reformat", async () => {
    const preview = { ...PREVIEW, settings: { ...PROPOSAL, reformats: true } };
    const { view, sent } = setup({ preview });
    render(view);
    await listing();
    const opened = await open();
    const apply = () =>
      within(
        (screen.queryByRole("alertdialog") as HTMLElement | null) ?? document.body,
      ).queryByRole("button", { name: "Apply the setup" }) as HTMLButtonElement | null;
    const offBefore = apply()?.disabled ?? false;
    const tick = screen.queryByRole("checkbox");
    if (tick) await act(async () => fireEvent.click(tick));
    const offAfter = apply()?.disabled ?? true;
    await click("Apply the setup", true);
    await settleMaybe(() => sent.some(([type]) => type === "project.harness.apply"));
    expect([
      opened,
      offBefore,
      offAfter,
      (sent.find(([type]) => type === "project.harness.apply")?.[1] as { reformat?: boolean })
        ?.reformat,
    ]).toEqual([true, true, false, true]);
  });

  test("a stale refusal says so and offers a new preview; nothing is applied again on its own", async () => {
    const stale: Answer = {
      ok: false,
      code: "invalid_state",
      message: "the project changed since the preview: preview again",
      reason: "harness_stale",
    };
    const { view, count } = setup({ answers: [stale] });
    render(view);
    await listing();
    await open();
    await click("Apply the setup", true);
    const said = await settleMaybe(() => screen.queryByText(/changed since the preview/) !== null);
    // Watched for a while: the count leaves 1 (a second apply, or none) or it does not.
    const oneApply = () => settleMaybe(() => count("project.harness.apply") !== 1, 300);
    const movedBefore = await oneApply();
    const again = await click("Preview again");
    const reopened = await settleMaybe(() => screen.queryByRole("alertdialog") !== null);
    const movedAfter = await oneApply();
    expect([
      said,
      movedBefore,
      again,
      reopened,
      movedAfter,
      count("project.harness.preview"),
    ]).toEqual([true, false, true, true, false, 2]);
  });

  test("Cancel closes the dialog and applies nothing", async () => {
    const { view, count } = setup();
    render(view);
    await listing();
    const opened = await open();
    const cancelled = await click(/^Cancel/, true);
    const closed = await settleMaybe(() => screen.queryByRole("alertdialog") === null);
    expect([opened, cancelled, closed, count("project.harness.apply")]).toEqual([
      true,
      true,
      true,
      0,
    ]);
  });

  test("a preview with nothing to add says so, and Apply stays off", async () => {
    const preview: HarnessPreview = { settings: null, files: [], unreadable: [] };
    const { view } = setup({ preview });
    render(view);
    await listing();
    const opened = await open();
    const apply = within(
      (screen.queryByRole("alertdialog") as HTMLElement | null) ?? document.body,
    ).queryByRole("button", { name: "Apply the setup" }) as HTMLButtonElement | null;
    expect([opened, dialogText().includes("Nothing to add"), apply?.disabled]).toEqual([
      true,
      true,
      true,
    ]);
  });

  test("in Portuguese too", async () => {
    const { view } = setup({ language: "pt-BR" });
    render(view);
    await listing("O que este projeto carregaria");
    const shown = await settleMaybe(() => button("Configurar o Claude Code") !== null);
    if (shown) await click("Configurar o Claude Code");
    const opened = await settleMaybe(() => screen.queryByRole("alertdialog") !== null);
    const text = dialogText();
    expect([
      shown,
      opened,
      text.includes("um pull pode mudá-lo"),
      text.includes("Aplicar a configuração"),
    ]).toEqual([true, true, true, true]);
  });
});
