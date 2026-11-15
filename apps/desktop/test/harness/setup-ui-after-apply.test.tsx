import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { settleMaybe } from "../wait.ts";
import {
  type Answer,
  act,
  button,
  cleanup,
  click,
  dialogText,
  FEATURES,
  listing,
  open,
  render,
  SETTINGS,
  screen,
  setup,
  within,
} from "./setup-ui-setup.tsx";

setDefaultTimeout(30_000);
afterEach(cleanup);

describe("harness-setup-ui-after-apply: the commit offer, the CLAUDE.md draft and the focus once the apply ran (#75)", () => {
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
    expect(button("Commit on a new branch") !== null).toBe(false); // NOSONAR: the boolean keeps a DOM node out of the failure diff
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

  test("after Apply the focus is on the outcome, not the page; a refused commit is an alert, focused too (#1090)", async () => {
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
    await settleMaybe(() => screen.queryByText(/Set up:/) !== null);
    const focused = () => document.activeElement;
    const appliedFocus =
      focused() !== document.body && (focused()?.textContent ?? "").includes("Set up:");
    await click("Commit on a new branch");
    await settleMaybe(() => screen.queryByRole("alertdialog") !== null);
    await click("Commit on a new branch", true);
    await settleMaybe(() => screen.queryByText(/Git has no name and email/) !== null);
    const alert = screen.queryByRole("alert");
    expect([
      appliedFocus,
      (alert?.textContent ?? "").includes("Git has no name and email"),
      alert !== null && alert.contains(focused()),
    ]).toEqual([true, true, true]);
  });

  test("each outcome takes the focus in its own region: a done apply and commit in the status, a stale apply in the alert", async () => {
    const run = async (answers: Answer[], commit: boolean) => {
      const { view } = setup({ features: [...FEATURES, "harnessCommit"], answers });
      render(view);
      await listing();
      await open();
      await click("Apply the setup", true);
      await settleMaybe(() => document.activeElement !== document.body);
      if (commit) {
        await settleMaybe(() => button("Commit on a new branch") !== null);
        await click("Commit on a new branch");
        await settleMaybe(() => screen.queryByRole("alertdialog") !== null);
        await click("Commit on a new branch", true);
        await settleMaybe(() => screen.queryByText(/Committed on/) !== null);
      }
      const role = document.activeElement?.getAttribute("role") ?? null;
      const live = document.activeElement?.getAttribute("aria-live") ?? null;
      cleanup();
      return [role, live];
    };
    const applied = await run(
      [{ ok: true, data: { written: [SETTINGS], digests: { [SETTINGS]: "w" } } }],
      false,
    );
    const committed = await run(
      [
        { ok: true, data: { written: [SETTINGS], digests: { [SETTINGS]: "w" } } },
        { ok: true, data: { branch: "flightdeck/claude-setup-x", commit: "c", files: [SETTINGS] } },
      ],
      true,
    );
    const stale = await run(
      [{ ok: false, code: "invalid_state", message: "refused", reason: "harness_stale" }],
      false,
    );
    // The regions stay live: if the focus were lost, the outcome would still be read.
    expect(applied).toEqual(["status", null]);
    expect(committed).toEqual(["status", null]);
    expect(stale).toEqual(["alert", null]);
  });
});
