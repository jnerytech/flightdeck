import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { WorkflowInfo, WorkflowRun } from "@flightdeck/protocol";
import { registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { settleMaybe } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { AppStore } = await import("../src/lib/app-store.ts");
const { TContext } = await import("../src/i18n/context.tsx");
const { RunAgain } = await import("../src/components/card/run-again.tsx");
const { RunTimeline } = await import("../src/ui/RunTimeline.tsx");
const { runAgain } = await import("../src/lib/runs.ts");

setDefaultTimeout(30_000);
afterEach(cleanup);

/**
 * Issue #1219: a failed run on the card starts again, with the same workflow, inputs, card and
 * branch (`card.start`). It is off, with the reason and a way to the Workflows page, when the file
 * is the problem. The run's own reason stays above it.
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

describe("run-again: the state a failed run offers", () => {
  test("a failed run offers it when its file is trusted and valid, and says why not otherwise", () => {
    const state = (status: WorkflowRun["status"], file: WorkflowInfo | undefined, known = true) =>
      runAgain({ status }, file, known);
    expect([
      state("failed", workflow()),
      state("failed", workflow(), false),
      state("failed", undefined),
      state("failed", workflow({ trusted: false })),
      state("failed", workflow({ trusted: false, errors: ["bad yaml"] })),
      state("running", workflow()),
      state("completed", workflow()),
      state("queued", workflow()),
    ]).toEqual([
      { show: true, off: null },
      { show: true, off: "loading" },
      { show: true, off: "missing" },
      { show: true, off: "untrusted" },
      { show: true, off: "invalid" },
      { show: false },
      { show: false },
      { show: false },
    ]);
  });
});

type Answer =
  | { ok: true; data: unknown }
  | { ok: false; code: string; message: string; reason?: string; params?: Record<string, string> };

function setup(
  options: {
    language?: "en" | "pt-BR";
    file?: WorkflowInfo | undefined;
    known?: boolean;
    answer?: Answer;
    failed?: WorkflowRun;
  } = {},
) {
  const store = new AppStore(memoryPlatform(false, options.language ?? "en").platform, {
    baseDelayMs: 600_000,
  });
  store.i18n.start();
  const sent: Array<[string, unknown]> = [];
  store.hostRequest = (async (_host: string, type: string, payload: unknown) => {
    sent.push([type, payload]);
    return options.answer ?? { ok: true, data: { id: "c1" } };
  }) as never;
  const opened: string[] = [];
  const failed = options.failed ?? run();
  const again = (
    <RunAgain
      store={store}
      hostId="h1"
      cardId="c1"
      run={failed}
      workflow={"file" in options ? options.file : workflow()}
      known={options.known ?? true}
      onOpenWorkflows={() => opened.push("workflows")}
    />
  );
  const view = (
    <TContext.Provider value={store.i18n.t}>
      <RunTimeline run={failed} formatTime={() => "10:00"} onOpenStep={() => {}} action={again} />
    </TContext.Provider>
  );
  return { store, sent, opened, view };
}

const button = (name: string | RegExp) =>
  screen.queryByRole("button", { name }) as HTMLButtonElement | null;
async function click(target: HTMLElement | null) {
  if (target) await act(async () => fireEvent.click(target));
  return target !== null;
}

describe("run-again-ui: Run again on a failed run (#1219)", () => {
  test("Run again starts the card with the same workflow and inputs", async () => {
    const { view, sent } = setup();
    render(view);
    await click(button("Run again"));
    await settleMaybe(() => sent.length === 1, 5000);
    expect(sent).toEqual([
      ["card.start", { cardId: "c1", workflow: "feature", inputs: { topic: "login" } }],
    ]);
  });

  test("the run's reason stays above the button, and the button waits for the host's answer on the file", async () => {
    const ready = setup();
    render(ready.view);
    const reason = screen.queryByText("check failed");
    const run = button("Run again");
    const above =
      reason !== null && run !== null && (reason.compareDocumentPosition(run) & 4) !== 0;
    cleanup();
    const loading = setup({ known: false });
    render(loading.view);
    expect([above, button("Run again")?.disabled]).toEqual([true, true]);
  });

  test("a file that is not trusted any more turns it off, says why, and leads to the Workflows page", async () => {
    const { view, sent, opened } = setup({ file: workflow({ trusted: false }) });
    render(view);
    const off = button("Run again");
    await click(off);
    await click(button("Open Workflows"));
    expect([
      off?.disabled,
      screen.queryByText(/changed since you trusted it/) !== null,
      sent.length,
      opened,
    ]).toEqual([true, true, 0, ["workflows"]]);
  });

  test("a file with errors, or gone from the base branch, says so", async () => {
    const invalid = setup({ file: workflow({ errors: ["bad"] }) });
    render(invalid.view);
    const bad = screen.queryByText(/has errors/) !== null;
    cleanup();
    const missing = setup({ file: undefined });
    render(missing.view);
    expect([bad, screen.queryByText(/is not on the base branch/) !== null]).toEqual([true, true]);
  });

  test("a refusal shows in place, and nothing is offered for a run that is still going", async () => {
    const refused = setup({
      answer: {
        ok: false,
        code: "invalid_state",
        message: "x",
        reason: "workflow_not_trusted",
        params: { name: "feature" },
      },
    });
    render(refused.view);
    await click(button("Run again"));
    const shown = await settleMaybe(
      () => screen.queryAllByRole("alert").some((box) => (box.textContent ?? "") !== ""),
      5000,
    );
    cleanup();
    const going = setup({ failed: run({ status: "running" }) });
    render(going.view);
    expect([shown, button("Run again")]).toEqual([true, null]);
  });

  test("the pt-BR button and reasons are in Portuguese", async () => {
    const { view } = setup({ language: "pt-BR", file: workflow({ trusted: false }) });
    render(view);
    expect([button("Executar de novo") !== null, button("Abrir Workflows") !== null]).toEqual([
      true,
      true,
    ]);
  });
});
