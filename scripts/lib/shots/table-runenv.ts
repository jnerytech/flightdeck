/**
 * Part of the print table (scripts/demo-shots.ts): the states of a card's Run environment panel
 * (#4287). The demo's project has no run.yaml and no run may start on its host, so the run.yaml and
 * each run's state are the page's own answers (`reply` and `reject` wire rules, #3982): nothing
 * reaches the host, which keeps its card as it was.
 */
import type { RunConfigInfo, RunProcessState, RunState } from "@flightdeck/protocol";
import type { Page } from "playwright-core";
import type { DemoIds } from "../../demo-seed.ts";
import { ALFA, type Shot } from "./shot.ts";
import type { WireRule } from "./wire.ts";

const PANEL = /^(Run environment|Ambiente de execução)$/;
const TRUST = /^(Trust this run\.yaml|Confiar neste run\.yaml)$/;
const CONFIRM = /^(Trust|Confiar)$/;
const RUN = /^(Run|Executar)$/;

/** The hash the person reviewed: the host trusts that file and no other. */
const HASH = "9f2c".repeat(16);

const API: RunConfigInfo["config"] = {
  exclusive: false,
  setup: ["bun", "install", "--frozen-lockfile"],
  run: [
    { name: "api", cmd: ["bun", "run", "api"], env: {}, ready: { http: "/health" } },
    { name: "web", cmd: ["bun", "run", "dev", "--host"], env: {}, ready: { http: "/" } },
    { name: "worker", cmd: ["bun", "run", "worker"], env: {}, ready: null },
  ],
  ports: ["api", "web"],
};

const info = (over: Partial<RunConfigInfo>): RunConfigInfo => ({
  exists: true,
  hash: HASH,
  trusted: false,
  errors: [],
  config: API,
  ...over,
});

const proc = (name: string, over: Partial<RunProcessState>): RunProcessState => ({
  name,
  terminalId: `term-${name}`,
  status: "running",
  exitCode: null,
  url: null,
  ready: "none",
  ...over,
});

/** A card's run as the host would tell it; `cardId` is the demo card's. */
const run = (cardId: string, over: Partial<RunState>): RunState => ({
  cardId,
  status: "running",
  setup: "done",
  setupTerminalId: "term-setup",
  ports: { api: 4101, web: 4102 },
  processes: [],
  error: null,
  ...over,
});

const panel = (page: Page) => page.getByRole("region", { name: PANEL });

/** Waits for the panel, which draws only after the page's answer about the run.yaml. */
async function openPanel(page: Page, text: RegExp): Promise<void> {
  await panel(page).getByText(text).first().waitFor({ timeout: 15_000 });
}

const pressTrust = (page: Page) => panel(page).getByRole("button", { name: TRUST }).click();
const clickRun = (page: Page) => panel(page).getByRole("button", { name: RUN }).click();

/** Presses Run, and waits for `text` (the state the page's answer puts in the panel). */
async function pressRun(page: Page, text: RegExp): Promise<void> {
  await clickRun(page);
  await panel(page).getByText(text).first().waitFor({ timeout: 15_000 });
}

export function runenvShots(ids: DemoIds): Shot[] {
  const card = { name: "card", host: ALFA, projectId: ids.project, cardId: ids.diffCard } as const;
  const config = (over: Partial<RunConfigInfo>): WireRule => ({
    command: "runenv.config",
    reply: info(over),
  });
  const trusted = config({ trusted: true });
  const started = (over: Partial<RunState>): WireRule => ({
    command: "runenv.start",
    reply: run(ids.diffCard, over),
  });
  return [
    {
      // An untrusted run.yaml: the commands to review, and Trust. Nothing runs before it.
      name: "card-ambiente-revisar",
      route: card,
      wire: [config({})],
      prepare: (page) => openPanel(page, TRUST),
    },
    {
      // Trust asks first, and says what the file may do. Nothing is confirmed.
      name: "card-ambiente-confiar",
      route: card,
      wire: [config({})],
      prepare: async (page) => {
        await pressTrust(page);
        await page.getByRole("alertdialog").waitFor();
      },
    },
    {
      // The host refuses the Trust: the review stays, with a line saying so.
      name: "card-ambiente-confianca-recusada",
      route: card,
      wire: [
        config({}),
        { command: "runenv.trust", reject: "The run.yaml changed since you reviewed it." },
      ],
      prepare: async (page) => {
        await pressTrust(page);
        await page.getByRole("alertdialog").getByRole("button", { name: CONFIRM }).click();
        await panel(page)
          .getByText(/^(The host did not accept the trust\.|O host não aceitou a confiança\.)/)
          .first()
          .waitFor({ timeout: 15_000 });
      },
    },
    {
      // A run.yaml the host could not read: what is wrong with it, and no Trust to press.
      name: "card-ambiente-erros",
      route: card,
      wire: [
        config({
          config: null,
          errors: ["run[1].cmd: must not be empty", 'ports: "api" is used by two processes'],
        }),
      ],
      prepare: (page) => openPanel(page, /^(The run\.yaml has errors:|O run\.yaml tem erros:)$/),
    },
    {
      // Trusted and not running: Run, and the state "Not running".
      name: "card-ambiente-parado",
      route: card,
      wire: [trusted],
      prepare: (page) => openPanel(page, /^(Not running|Parado)$/),
    },
    {
      // The setup runs first: its status and the button to read its log.
      name: "card-ambiente-setup",
      route: card,
      wire: [trusted, started({ status: "setup", setup: "running" })],
      prepare: async (page) => {
        await pressRun(page, /^(Preparing \(setup\)…|Preparando \(setup\)…)$/);
        await panel(page)
          .getByRole("button", { name: /^(View log of Setup|Ver log de Setup)$/ })
          .waitFor();
      },
    },
    {
      // Running with its ports: one process ready (its preview opens), one still waiting, one that
      // never answered in time.
      name: "card-ambiente-rodando",
      route: card,
      wire: [
        trusted,
        started({
          processes: [
            proc("api", { ready: "ready", url: "http://127.0.0.1:4101" }),
            proc("web", { ready: "waiting", url: "http://127.0.0.1:4102" }),
            proc("worker", { ready: "timeout" }),
          ],
        }),
      ],
      prepare: (page) => pressRun(page, /^(Open preview of api|Abrir preview de api)$/),
    },
    {
      // A process that crashed (code 1, in the error colour) and one a signal ended (no code).
      name: "card-ambiente-caiu",
      route: card,
      wire: [
        trusted,
        started({
          processes: [
            proc("api", { ready: "ready", url: "http://127.0.0.1:4101" }),
            proc("web", { status: "exited", exitCode: 1 }),
            proc("worker", { status: "exited", exitCode: null }),
          ],
        }),
      ],
      prepare: (page) => pressRun(page, /^(ended \(code 1\)|encerrado \(código 1\))$/),
    },
    {
      // The run failed: the reason is an alert under the status, in the person's language.
      name: "card-ambiente-falhou",
      route: card,
      wire: [
        trusted,
        started({
          status: "failed",
          setup: "failed",
          ports: {},
          error: "the setup failed (code 1)",
          errorKey: "run_setup_failed",
          errorParams: { code: 1 },
        }),
      ],
      prepare: async (page) => {
        await clickRun(page);
        await panel(page)
          .getByRole("alert")
          .filter({ hasText: /\(code 1\)|\(código 1\)/ })
          .waitFor({ timeout: 15_000 });
      },
    },
    {
      // The host refuses to start the run at all: its words stay in the app's alert.
      name: "card-ambiente-recusado",
      route: card,
      wire: [trusted, { command: "runenv.start", reject: "No free block of ports on this host." }],
      prepare: async (page) => {
        await clickRun(page);
        // The refusal is a toast with the host's words, not an alert of the panel.
        await page
          .getByText("No free block of ports on this host.")
          .first()
          .waitFor({ timeout: 15_000 });
      },
    },
  ];
}
