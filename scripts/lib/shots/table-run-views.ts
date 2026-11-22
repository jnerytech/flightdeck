/**
 * Part of the print table (scripts/demo-shots.ts): the preview page and a card's workflow timeline
 * in the states the prints did not show (#4287). The demo's host has nothing listening on a
 * preview address, so the frame gets a small page of its own, and its run waits at a gate: the
 * timeline's states are the page's own answers to `run.get`, and `run.watch` is answered in the
 * page too, so the host's own pushes never replace them.
 */
import { createRequire } from "node:module";
import type { RunStatus, StepRun, WorkflowRun } from "@flightdeck/protocol";
import type { Page } from "playwright-core";
import type { DemoIds } from "../../demo-seed.ts";
import { ALFA, type Shot } from "./shot.ts";
import type { WireRule } from "./wire.ts";

/** axe-core's browser bundle: the print's axe run waits for a frame that has none. */
const AXE = createRequire(import.meta.url).resolve("axe-core/axe.min.js");

const RUN_REGION = /^(Workflow run|Execução do workflow)$/;
const STATUS_WORDS: Record<string, string> = {
  running: "running|em andamento",
  failed: "failed|falhou",
};

/** What the frame shows: a page of the app under preview, valid enough for the axe check. */
const FRAME_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Cart</title></head><body style="font-family:sans-serif;margin:24px"><main><h1>Cart</h1><p>2 items · total 40.00</p></main></body></html>`;

/** `seconds` before the print: the wire turns `{in -Ns}` into that time. */
const ago = (seconds: number): string => `{in -${seconds}s}`;

const step = (over: Partial<StepRun> & Pick<StepRun, "stepId">): StepRun => ({
  attempt: 1,
  type: "agent",
  status: "completed",
  sessionId: null,
  output: null,
  exitCode: null,
  note: null,
  message: null,
  usage: null,
  startedAt: ago(600),
  endedAt: ago(300),
  ...over,
});

/** A finished agent step: it has a session, so the timeline offers to open it. */
const agent = (stepId: string, over: Partial<StepRun> = {}): StepRun =>
  step({
    stepId,
    sessionId: `session-${stepId}`,
    usage: { turns: 6, minutes: 4, costUsd: 0.42 },
    ...over,
  });

const check = (stepId: string, over: Partial<StepRun> = {}): StepRun =>
  step({ stepId, type: "check", exitCode: 0, ...over });

const runOf = (id: string, cardId: string, over: Partial<WorkflowRun>): WorkflowRun => ({
  id,
  cardId,
  workflowName: "feature",
  workflowHash: "9f2c".repeat(16),
  status: "running",
  statusReason: null,
  budget: { maxTurns: 40, maxMinutes: 60, maxCostUsd: 10 },
  usage: { turns: 9, minutes: 6, costUsd: 0.73 },
  inputs: {},
  startedAt: ago(700),
  endedAt: null,
  steps: [],
  quotaUntil: null,
  ...over,
});

/** The step that is running as the print is taken. */
const working = (stepId: string): StepRun =>
  agent(stepId, {
    status: "running",
    startedAt: ago(240),
    endedAt: null,
    usage: { turns: 3, minutes: 2, costUsd: 0.31 },
  });

/** Waits for the timeline's title in the state the print shows. */
async function timelineShows(page: Page, status: RunStatus): Promise<void> {
  const words = STATUS_WORDS[status] ?? status;
  await page
    .getByRole("region", { name: RUN_REGION })
    .getByRole("heading", { name: new RegExp(`^Workflow feature · (${words})$`) })
    .waitFor({ timeout: 15_000 });
}

export function runViewShots(ids: DemoIds): Shot[] {
  const route = { name: "card", host: ALFA, projectId: ids.project, cardId: ids.gateCard } as const;
  const timeline = (name: string, status: RunStatus, over: Partial<WorkflowRun>): Shot => ({
    name,
    route,
    wire: [
      { command: "run.watch", reply: null },
      { command: "run.get", reply: runOf(ids.gateRunId, ids.gateCard, { status, ...over }) },
    ] satisfies WireRule[],
    prepare: (page) => timelineShows(page, status),
  });
  const plan = agent("plan");
  return [
    {
      // The app's frame, and a button to open it in the browser.
      name: "previa-ambiente",
      route: { name: "preview", url: "http://127.0.0.1:4101", title: "api" },
      prepare: async (page) => {
        await page
          .locator("iframe")
          .evaluate((el, html) => el.setAttribute("srcdoc", html), FRAME_HTML);
        await page
          .frameLocator("iframe")
          .getByRole("heading", { name: "Cart" })
          .waitFor({ timeout: 15_000 });
        // The print's axe run asks every frame, and waits a minute for one without axe.
        const inner = page.frames().find((frame) => frame !== page.mainFrame());
        await inner?.addScriptTag({ path: AXE });
      },
    },
    {
      // An address that is not this computer's: no frame, and the reason.
      name: "previa-recusada",
      route: { name: "preview", url: "http://192.168.1.20:3000/", title: "api" },
      prepare: async (page) => {
        await page
          .getByText(
            /^(Only 127\.0\.0\.1 and localhost addresses open here\.|Só endereços de 127\.0\.0\.1 e localhost abrem aqui\.)$/,
          )
          .waitFor({ timeout: 15_000 });
      },
    },
    // Planned, checked, and the implementation under way.
    timeline("card-run-rodando", "running", {
      steps: [plan, check("tests"), working("implement")],
    }),
    // The run waits for the plan's quota before the next turn.
    timeline("card-run-cota", "running", {
      steps: [plan, check("tests"), working("implement")],
      quotaUntil: "{in 1800s}",
    }),
    // A failed run: the reason, in the person's language, and where it stopped.
    timeline("card-run-falhou", "failed", {
      statusReason: "The run's card is gone, so the run stopped when Flightdeck started again.",
      reasonKey: "run_card_gone",
      endedAt: ago(30),
      steps: [plan, check("tests", { status: "failed", exitCode: 1 })],
    }),
    // A check that failed once and passed on its second attempt.
    timeline("card-run-tentativa", "running", {
      steps: [
        plan,
        check("tests", { status: "failed", exitCode: 1 }),
        agent("fix", { startedAt: ago(280), endedAt: ago(200) }),
        check("tests", { attempt: 2, startedAt: ago(200), endedAt: ago(150) }),
        working("review"),
      ],
    }),
    // A step id that does not fit a narrow line: it must wrap, not push the page sideways.
    timeline("card-run-passo-longo", "running", {
      steps: [
        plan,
        check("run-the-whole-integration-suite-against-the-staging-database-and-compare"),
        working("implement-the-change-and-update-every-caller-of-the-renamed-function"),
      ],
    }),
  ];
}
