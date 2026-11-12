import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { WorkflowInfo, WorkflowRun } from "@flightdeck/protocol";
import { registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";
import { settleMaybe, stays } from "../wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { AppStore } = await import("../../src/lib/app-store.ts");
const { TContext } = await import("../../src/i18n/context.tsx");
const { RunAgain } = await import("../../src/features/board/run-again.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

/**
 * Issue #1266: a failed run goes on from its failed step. The app asks the host whether it can
 * (`run.resume` without `confirm`) and offers "Run again from <step>" before "Run again"; otherwise
 * it says why under "Run again". The confirm answers in place, and the run stays in the panel while
 * it runs again, since a resume keeps the run's id.
 */
const run = (over: Partial<WorkflowRun> = {}) =>
  ({
    id: "r1",
    cardId: "c1",
    workflowName: "feature",
    workflowHash: "h",
    status: "failed",
    statusReason: "check failed",
    reasonKey: null,
    reasonParams: null,
    budget: {},
    usage: { turns: 1, minutes: 1, costUsd: 0.1 },
    inputs: { topic: "login" },
    startedAt: "2026-11-08T10:00:00.000Z",
    endedAt: "2026-11-08T10:05:00.000Z",
    steps: [],
    quotaUntil: null,
    ...over,
  }) as WorkflowRun;
const workflow = (over: Partial<WorkflowInfo> = {}): WorkflowInfo => ({
  name: "feature",
  hash: "h",
  trusted: true,
  checks: [],
  errors: [],
  inputs: ["topic"],
  ...over,
});

type Answer =
  | { ok: true; data: unknown }
  | { ok: false; code: string; message: string; reason?: string; params?: Record<string, string> };

const offer: Answer = { ok: true, data: { from: "c", ok: true } };

function setup(
  options: {
    language?: "en" | "pt-BR";
    check?: Answer;
    confirm?: Answer;
    file?: WorkflowInfo;
    /** Every request but the check waits for it. */
    hold?: Promise<void>;
  } = {},
) {
  const store = new AppStore(memoryPlatform(false, options.language ?? "en").platform, {
    baseDelayMs: 600_000,
  });
  store.i18n.start();
  const sent: Array<[string, unknown]> = [];
  store.hostRequest = (async (_host: string, type: string, payload: unknown) => {
    sent.push([type, payload]);
    const confirm = (payload as { confirm?: boolean }).confirm === true;
    if (options.hold && (type !== "run.resume" || confirm)) await options.hold;
    if (type !== "run.resume") return { ok: true, data: { id: "c1" } };
    return confirm ? (options.confirm ?? offer) : (options.check ?? offer);
  }) as never;
  const tree = (shown: WorkflowRun) => (
    <TContext.Provider value={store.i18n.t}>
      <RunAgain
        store={store}
        hostId="h1"
        cardId="c1"
        run={shown}
        workflow={options.file ?? workflow()}
        known
        onOpenWorkflows={() => {}}
      />
    </TContext.Provider>
  );
  return { sent, tree };
}

const button = (name: string | RegExp) =>
  screen.queryByRole("button", { name }) as HTMLButtonElement | null;
const text = (pattern: RegExp) => screen.queryByText(pattern) !== null;
const alerted = (pattern: RegExp) =>
  screen.queryAllByRole("alert").some((box) => pattern.test(box.textContent ?? ""));
async function click(target: HTMLElement | null) {
  if (target) await act(async () => fireEvent.click(target));
  return target !== null;
}

describe("run-resume-ui: Run again from the failed step (#1266)", () => {
  test("an ok check offers Run again from the step first; the confirm goes on, and the note keeps the focus while the run runs", async () => {
    const { sent, tree } = setup();
    const view = render(tree(run()));
    const offered = await settleMaybe(() => button("Run again from c") !== null, 5000);
    const from = button("Run again from c");
    const again = button("Run again");
    const first =
      from !== null && again !== null && (from.compareDocumentPosition(again) & 4) !== 0;
    await click(from);
    const note = () =>
      screen.queryAllByRole("status").find((box) => box.textContent === "Going on from c.") ?? null;
    const focused = await settleMaybe(
      () => note() !== null && document.activeElement === note(),
      5000,
    );
    // The resume keeps the run's id: back in the queue, the note and its focus stay.
    view.rerender(tree(run({ status: "queued", endedAt: null })));
    const kept = note() !== null && document.activeElement === note();
    expect([offered, first, focused, kept, sent]).toEqual([
      true,
      true,
      true,
      true,
      [
        ["run.resume", { runId: "r1" }],
        ["run.resume", { runId: "r1", confirm: true }],
      ],
    ]);
  });

  test("the run failing again brings the offers back, with a new check", async () => {
    const { sent, tree } = setup();
    const view = render(tree(run()));
    await settleMaybe(() => button("Run again from c") !== null, 5000);
    await click(button("Run again from c"));
    await settleMaybe(() => sent.length === 2, 5000);
    view.rerender(tree(run({ status: "running", endedAt: null })));
    view.rerender(tree(run({ endedAt: "2026-11-08T11:00:00.000Z" })));
    const back = await settleMaybe(() => button("Run again from c") !== null, 5000);
    expect([back, button("Run again") !== null, sent.length]).toEqual([true, true, 3]);
  });

  test("a check that says no shows its reason under Run again, which still starts the run", async () => {
    const { sent, tree } = setup({
      check: { ok: true, data: { from: "c", ok: false, reason: "run_resume_branch_moved" } },
    });
    render(tree(run()));
    const shown = await settleMaybe(() => text(/branch changed since this run stopped/), 5000);
    const again = button("Run again");
    const described = (again?.getAttribute("aria-describedby") ?? "") !== "";
    await click(again);
    await settleMaybe(() => sent.length === 2, 5000);
    expect([shown, button(/Run again from/), described, sent[1]?.[0]]).toEqual([
      true,
      null,
      true,
      "card.start",
    ]);
  });

  test("a far host's check names the near connection; a run that is not failed any more says nothing", async () => {
    const far = setup({
      check: { ok: true, data: { from: "c", ok: false, reason: "transport_refused" } },
    });
    render(far.tree(run()));
    const near = await settleMaybe(() => text(/only works over a near connection/), 5000);
    cleanup();
    const busy = setup({
      check: { ok: true, data: { from: "c", ok: false, reason: "run_resume_not_failed" } },
    });
    render(busy.tree(run()));
    await settleMaybe(() => busy.sent.length === 1, 5000);
    // The request leaving is not its answer shown: watch the window, so a later answer is seen.
    await stays(() => !text(/Only a run that failed/));
    expect([near, text(/Only a run that failed/), button("Run again") !== null]).toEqual([
      true,
      false,
      true,
    ]);
  });

  test("a confirm that the host refuses, or that checks no again, says why in place", async () => {
    const moved = setup({
      confirm: { ok: true, data: { from: "c", ok: false, reason: "run_resume_branch_moved" } },
    });
    render(moved.tree(run()));
    await settleMaybe(() => button("Run again from c") !== null, 5000);
    await click(button("Run again from c"));
    const said = await settleMaybe(() => alerted(/branch changed since this run stopped/), 5000);
    const gone = button(/Run again from/);
    cleanup();
    const refused = setup({
      confirm: { ok: false, code: "invalid_state", message: "x", reason: "transport_refused" },
    });
    render(refused.tree(run()));
    await settleMaybe(() => button("Run again from c") !== null, 5000);
    await click(button("Run again from c"));
    const far = await settleMaybe(() => alerted(/only works over a near connection/), 5000);
    expect([said, gone, far]).toEqual([true, null, true]);
  });

  test("while one request is going, the other button waits: no resume and start of the same card at once", async () => {
    let release = () => {};
    const resuming = setup({ hold: new Promise<void>((done) => (release = done)) });
    render(resuming.tree(run()));
    await settleMaybe(() => button("Run again from c") !== null, 5000);
    await click(button("Run again from c"));
    const startOff = button("Run again")?.disabled === true;
    await act(async () => release());
    cleanup();
    let releaseStart = () => {};
    const starting = setup({ hold: new Promise<void>((done) => (releaseStart = done)) });
    render(starting.tree(run()));
    await settleMaybe(() => button("Run again from c") !== null, 5000);
    await click(button("Run again"));
    const resumeOff = button("Run again from c")?.disabled === true;
    await act(async () => releaseStart());
    expect([startOff, resumeOff]).toEqual([true, true]);
  });

  test("an untrusted file keeps its own reason: no resume is checked or offered", async () => {
    const { sent, tree } = setup({ file: workflow({ trusted: false }) });
    render(tree(run()));
    const reason = text(/changed since you trusted it/);
    expect([reason, button(/Run again from/), sent]).toEqual([true, null, []]);
  });

  test("the pt-BR offer and note are in Portuguese", async () => {
    const { tree } = setup({ language: "pt-BR" });
    render(tree(run()));
    const offered = await settleMaybe(
      () => button("Executar de novo a partir de c") !== null,
      5000,
    );
    await click(button("Executar de novo a partir de c"));
    const note = await settleMaybe(() => text(/^Continuando a partir de c\.$/), 5000);
    expect([offered, note]).toEqual([true, true]);
  });
});
