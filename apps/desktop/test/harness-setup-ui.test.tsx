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
    answers?: Array<Answer | Promise<Answer>>;
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
      message: "refused",
      reason: "harness_stale",
    };
    const { view, count } = setup({ answers: [stale] });
    render(view);
    await listing();
    await open();
    await click("Apply the setup", true);
    // Only the translation has this: the daemon's own message here says something else.
    const said = await settleMaybe(
      () => screen.queryByText(/or the preview was not of these parts/) !== null,
    );
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

  test("a refusal a new preview cannot fix (a far connection) says why, with no Preview again", async () => {
    const far: Answer = {
      ok: false,
      code: "invalid_state",
      message: "refused",
      reason: "transport_refused",
    };
    const { view } = setup({ answers: [far] });
    render(view);
    await listing();
    await open();
    await click("Apply the setup", true);
    const said = await settleMaybe(() => screen.queryByText(/near connection/) !== null);
    expect([said, button("Preview again") !== null]).toEqual([true, false]);
  });

  test("while apply runs, Set up waits: a second preview cannot race the first apply", async () => {
    let answer: (value: Answer) => void = () => {};
    const slow = new Promise<Answer>((resolve) => {
      answer = resolve;
    });
    const { view } = setup({ answers: [slow] });
    render(view);
    await listing();
    await open();
    await click("Apply the setup", true);
    const waits = await settleMaybe(
      () => (button("Set up Claude Code") as HTMLButtonElement | null)?.disabled === true,
    );
    await act(async () => answer({ ok: true, data: { written: ["CLAUDE.md"] } }));
    const free = await settleMaybe(
      () => (button("Set up Claude Code") as HTMLButtonElement | null)?.disabled === false,
    );
    expect([waits, free]).toEqual([true, true]);
  });

  test("the card's hint promises a setup only on a host that can apply one", async () => {
    const both = setup();
    render(both.view);
    await listing();
    const promises = await settleMaybe(
      () => screen.queryByText(/Nothing changes until you read a setup and apply it/) !== null,
    );
    cleanup();
    const older = setup({ features: ["projectTrust", "harnessPreview"] });
    render(older.view);
    await listing();
    const readOnly = await settleMaybe(
      () => screen.queryByText(/Read-only: nothing here changes the project/) !== null,
    );
    expect([promises, readOnly]).toEqual([true, true]);
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

  // #168 round 3: the claude-code-preparar print's axe found each new file's toggle under 24 px
  // (WCAG 2.5.8, target-size). Each summary carries the shared 24 px target class.
  test("each new file's toggle is a 24 px target", async () => {
    const { view } = setup();
    render(view);
    await listing();
    expect(await open()).toBe(true);
    const toggles = Array.from(
      screen.queryByRole("alertdialog")?.querySelectorAll("details > summary") ?? [],
    );
    expect([
      toggles.length > 0,
      toggles.every((el) => el.className.split(" ").includes("hit-24")),
    ]).toEqual([true, true]);
  });

  test("after an apply, a host that can commit offers it, asks first, and sends the digests apply gave (#75 C1)", async () => {
    const digests = { [SETTINGS]: "w-settings", "CLAUDE.md": "w-claude" };
    const { view, sent } = setup({
      features: [...FEATURES, "harnessCommit"],
      answers: [
        { ok: true, data: { written: [SETTINGS, "CLAUDE.md"], digests } },
        {
          ok: true,
          data: { branch: "flightdeck/claude-setup-x", commit: "abc", files: [SETTINGS] },
        },
      ],
    });
    render(view);
    await listing();
    await open();
    await click("Apply the setup", true);
    const offered = await settleMaybe(() => button("Commit on a new branch") !== null);
    await click("Commit on a new branch");
    const asked = await settleMaybe(() => screen.queryByRole("alertdialog") !== null);
    const said = dialogText();
    await click("Commit on a new branch", true);
    const done = await settleMaybe(
      () => screen.queryByText(/Committed on flightdeck\/claude-setup-x/) !== null,
    );
    expect([
      offered,
      asked,
      said.includes("committed whole"),
      said.includes(".claude/settings.json"),
      sent.find(([type]) => type === "project.harness.commit")?.[1],
      done,
    ]).toEqual([true, true, true, true, { path: "/work/api", digests, confirm: true }, true]);
  });

  test("a host without the commit feature offers no commit after an apply", async () => {
    const { view } = setup();
    render(view);
    await listing();
    await open();
    await click("Apply the setup", true);
    await settleMaybe(() => screen.queryByText(/Set up:/) !== null);
    expect(button("Commit on a new branch") !== null).toBe(false);
  });

  test("a refused commit says why, in the app's words", async () => {
    const { view } = setup({
      features: [...FEATURES, "harnessCommit"],
      answers: [
        { ok: true, data: { written: [SETTINGS], digests: { [SETTINGS]: "w" } } },
        { ok: false, code: "invalid_state", message: "refused", reason: "harness_commit_identity" },
      ],
    });
    render(view);
    await listing();
    await open();
    await click("Apply the setup", true);
    await settleMaybe(() => button("Commit on a new branch") !== null);
    await click("Commit on a new branch");
    await settleMaybe(() => screen.queryByRole("alertdialog") !== null);
    await click("Commit on a new branch", true);
    const said = await settleMaybe(() => screen.queryByText(/Git has no name and email/) !== null);
    expect(said).toBe(true);
  });

  test("the commit offer follows the apply: none with no digests, none after a stale refusal, a retry after another", async () => {
    const applied = (digests: Record<string, string>) =>
      ({ ok: true, data: { written: [SETTINGS], digests } }) as const;
    const refused = (reason: string) =>
      ({ ok: false, code: "invalid_state", message: "refused", reason }) as const;
    const run = async (
      answers: Answer[],
      steps: (count: (t: string) => number) => Promise<unknown>,
    ) => {
      const { view, count } = setup({ features: [...FEATURES, "harnessCommit"], answers });
      render(view);
      await listing();
      await open();
      await click("Apply the setup", true);
      await settleMaybe(() => screen.queryByText(/Set up:/) !== null);
      const result = await steps(count);
      cleanup();
      return result;
    };
    const commitOnce = async () => {
      await click("Commit on a new branch");
      await settleMaybe(() => screen.queryByRole("alertdialog") !== null);
      await click("Commit on a new branch", true);
    };
    const empty = await run([applied({})], async () => button("Commit on a new branch") !== null);
    const stale = await run(
      [applied({ [SETTINGS]: "w" }), refused("harness_commit_stale")],
      async (count) => {
        await commitOnce();
        await settleMaybe(() => screen.queryByText(/apply the setup again/) !== null);
        return [count("project.harness.commit"), button("Commit on a new branch") !== null];
      },
    );
    const retry = await run(
      [applied({ [SETTINGS]: "w" }), refused("harness_commit_identity")],
      async (count) => {
        await commitOnce();
        await settleMaybe(() => screen.queryByText(/Git has no name and email/) !== null);
        return [count("project.harness.commit"), button("Commit on a new branch") !== null];
      },
    );
    const cancelled = await run([applied({ [SETTINGS]: "w" })], async (count) => {
      await click("Commit on a new branch");
      await settleMaybe(() => screen.queryByRole("alertdialog") !== null);
      await click(/^Cancel/, true);
      await settleMaybe(() => screen.queryByRole("alertdialog") === null);
      return count("project.harness.commit");
    });
    expect([empty, stale, retry, cancelled]).toEqual([false, [1, false], [1, true], 0]);
  });

  test("a new preview forgets the last apply: no commit of what an older apply wrote", async () => {
    const { view } = setup({
      features: [...FEATURES, "harnessCommit"],
      answers: [{ ok: true, data: { written: [SETTINGS], digests: { [SETTINGS]: "w" } } }],
    });
    render(view);
    await listing();
    await open();
    await click("Apply the setup", true);
    const offered = await settleMaybe(() => button("Commit on a new branch") !== null);
    await click("Set up Claude Code");
    await settleMaybe(() => screen.queryByRole("alertdialog") !== null);
    await click(/^Cancel/, true);
    await settleMaybe(() => screen.queryByRole("alertdialog") === null);
    expect([offered, button("Commit on a new branch") !== null]).toEqual([true, false]);
  });

  test("Draft with Claude puts the host's draft in place of the CLAUDE.md template, and apply sends its digest (#75 G1)", async () => {
    const draft = {
      path: "CLAUDE.md",
      content: "# Drafted shop\n\nRun `bun run test`.\n",
      digest: "d-draft",
    };
    const { view, sent } = setup({
      features: [...FEATURES, "harnessDraft"],
      answers: [
        { ok: true, data: draft },
        { ok: true, data: { written: ["CLAUDE.md"], digests: { "CLAUDE.md": "w" } } },
      ],
    });
    render(view);
    await listing();
    await open();
    // The step and its note are in sight, not inside a closed disclosure.
    const inClosed = (node: Element | null | undefined) => {
      const box = node?.closest("details");
      return box !== null && box !== undefined && !box.open;
    };
    const visibleButton = !inClosed(button("Draft with Claude"));
    const offered = await click("Draft with Claude", true);
    const shown = await settleMaybe(() => dialogText().includes("# Drafted shop"));
    const note = screen.queryByText(/Read it before you apply/);
    const said = note !== null && !inClosed(note);
    // Without a draft, the queued answers are not the apply's.
    if (offered) await click("Apply the setup", true);
    await settleMaybe(() => sent.some(([type]) => type === "project.harness.apply"));
    const applied = sent.find(([type]) => type === "project.harness.apply")?.[1] as
      | { digests?: Record<string, string> }
      | undefined;
    expect([
      visibleButton,
      offered,
      sent.find(([type]) => type === "project.harness.draft")?.[1],
      shown,
      said,
      applied?.digests?.["CLAUDE.md"],
      applied?.digests?.[SETTINGS],
    ]).toEqual([
      true,
      true,
      { path: "/work/api", part: "claudeMd" },
      true,
      true,
      "d-draft",
      "d-settings",
    ]);
  });

  test("a draft the host refuses says why and keeps the template; a host without drafts offers none", async () => {
    const refused = setup({
      features: [...FEATURES, "harnessDraft"],
      answers: [
        { ok: false, code: "invalid_state", message: "refused", reason: "harness_draft_failed" },
      ],
    });
    render(refused.view);
    await listing();
    await open();
    await click("Draft with Claude", true);
    const said = await settleMaybe(() => dialogText().includes("did not answer with a CLAUDE.md"));
    const kept = dialogText().includes("# Project notes");
    cleanup();
    const older = setup();
    render(older.view);
    await listing();
    await open();
    expect([said, kept, button("Draft with Claude") !== null]).toEqual([true, true, false]);
  });

  test("a draft still running keeps Apply off, and one that comes back after Cancel and a new preview changes nothing", async () => {
    let answer: (value: Answer) => void = () => {};
    const slow = new Promise<Answer>((resolve) => {
      answer = resolve;
    });
    const { view, sent, count } = setup({
      features: [...FEATURES, "harnessDraft"],
      answers: [
        slow,
        { ok: true, data: { written: ["CLAUDE.md"], digests: { "CLAUDE.md": "w" } } },
      ],
    });
    render(view);
    await listing();
    await open();
    await click("Draft with Claude", true);
    const applyOff = (
      within(screen.queryByRole("alertdialog") as HTMLElement).queryByRole("button", {
        name: "Apply the setup",
      }) as HTMLButtonElement | null
    )?.disabled;
    await click(/^Cancel/, true);
    await settleMaybe(() => screen.queryByRole("alertdialog") === null);
    await click("Set up Claude Code");
    await settleMaybe(() => screen.queryByRole("alertdialog") !== null);
    // The old draft comes back now: it belongs to no preview on screen.
    await act(async () =>
      answer({
        ok: true,
        data: { path: "CLAUDE.md", content: "# Late draft\n", digest: "d-late" },
      }),
    );
    const stillTemplate = !dialogText().includes("# Late draft");
    const canDraft = (button("Draft with Claude") as HTMLButtonElement | null)?.disabled === false;
    await click("Apply the setup", true);
    await settleMaybe(() => sent.some(([type]) => type === "project.harness.apply"));
    const applied = sent.find(([type]) => type === "project.harness.apply")?.[1] as
      | { digests?: Record<string, string> }
      | undefined;
    expect([
      applyOff,
      stillTemplate,
      canDraft,
      applied?.digests?.["CLAUDE.md"],
      count("project.harness.draft"),
    ]).toEqual([true, true, true, "d-claude", 1]);
  });
});
