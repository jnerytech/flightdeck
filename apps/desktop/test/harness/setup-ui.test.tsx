import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { HarnessPreview } from "@flightdeck/protocol";
import { settleMaybe, uiIdle } from "../wait.ts";
import {
  ALL,
  type Answer,
  act,
  button,
  cleanup,
  click,
  dialogText,
  FEATURES,
  fireEvent,
  listing,
  open,
  PREVIEW,
  PROPOSAL,
  render,
  SETTINGS,
  screen,
  setup,
  within,
} from "./setup-ui-setup.tsx";

setDefaultTimeout(30_000);
afterEach(cleanup);

describe("harness-setup-ui: the project page sets up Claude Code after the person read the preview (#75)", () => {
  test("only a host that keeps setup templates offers to share the project's setup", async () => {
    const withTemplates = setup({ features: [...FEATURES, "harnessTemplates"] });
    render(withTemplates.view);
    await listing();
    const offered = await settleMaybe(() => button("Share as template") !== null);
    cleanup();
    const without = setup();
    render(without.view);
    await listing();
    await uiIdle();
    expect([offered, button("Share as template") !== null]).toEqual([true, false]);
  });

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
});
