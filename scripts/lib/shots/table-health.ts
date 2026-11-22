/** Part of the print table (scripts/demo-shots.ts), in print order: the states of a host's Health & dependencies the audit of #168 found (#4325). */

import type { DepResult, DepsResult, DoctorResult } from "@flightdeck/protocol";
import type { Locator, Page } from "playwright-core";
import type { DemoIds } from "../../demo-seed.ts";
import { ALFA, type Shot, showSection } from "./shot.ts";
import type { WireRule } from "./wire.ts";

const TITLE = /^(Health & dependencies|Saúde e dependências)$/;
const panel = (page: Page): Locator => page.getByRole("region", { name: TITLE });
const showHealth = showSection(TITLE);
/** The count line shows once a read worked: its rows are on the page. */
const COUNTS = /^OK: \d+/;
const INSTALL_HOOKS = /^(Install hooks|Instalar hooks)$/;
const TURN_ON_ROW = /^(Turn on start at boot|Ligar início no boot)$/;
const TURN_ON = /^(Turn it on|Ligar)$/;
const CHECK_AGAIN = /^(Check again|Verificar de novo)$/;
const READ_FAILED = /^(Could not read the health|Não foi possível ler a saúde)/;
const CHECKING = /^(Checking…|Verificando…)$/;
const SHOW_FINE = /^(Show \d+ checks|Mostrar \d+ itens)/;
const WORKING = /^(Working|Funcionando)$/;
const BOOT_NOTE = /^(Start at boot|Iniciar no boot)$/;

/** How to install a tool on each system, a command and the official page. */
function fixes(command: string, url: string): DepResult["fix"] {
  return (["linux", "darwin", "win32"] as const).map((os) => ({ os, command, url }));
}

/** One dependency as `deps.check` answers it. */
function dep(
  id: DepResult["id"],
  group: DepResult["group"],
  state: DepResult["state"],
  extra: Partial<DepResult> = {},
): DepResult {
  return { id, group, state, breaks: [], fix: [], ...extra };
}

const CLAUDE_PATH =
  "/home/demo/.local/share/pnpm/global/5/node_modules/@anthropic-ai/claude-code/bin/claude";
const GIT_PAGE = "https://git-scm.com/downloads";
const SERVICE_COMMAND = "flightdeckd service install";

/** The demo host with everything in place: what the rows of the other prints start from. */
const HEALTHY: DepResult[] = [
  dep("claude", "required", "ok", { version: "2.1.4", path: CLAUDE_PATH }),
  dep("git", "required", "ok", { version: "2.43.0", path: "/usr/bin/git" }),
  dep("hooks", "required", "ok"),
  dep("folders", "required", "ok"),
  dep("service", "required", "ok"),
  dep("gh", "optional", "ok", { version: "2.45.0", path: "/usr/bin/gh" }),
];

/** `HEALTHY` with these dependencies changed. */
function healthy(...changed: DepResult[]): DepsResult {
  return { items: HEALTHY.map((item) => changed.find((one) => one.id === item.id) ?? item) };
}

const DOCTOR: DoctorResult = { ok: true, checks: [] };
const answers = (deps: DepsResult): WireRule[] => [
  { command: "deps.check", data: deps },
  { command: "doctor.run", data: DOCTOR },
];

const MISSING: DepsResult = healthy(
  dep("claude", "required", "outdated", {
    version: "1.0.4",
    minVersion: "2.0.0",
    path: CLAUDE_PATH,
    breaks: ["sessions"],
    fix: fixes(
      "npm install -g @anthropic-ai/claude-code",
      "https://docs.anthropic.com/en/docs/claude-code/setup",
    ),
  }),
  dep("git", "required", "missing", {
    breaks: ["projects", "worktrees"],
    fix: fixes("sudo apt install git", GIT_PAGE),
  }),
  dep("gh", "optional", "missing", {
    breaks: ["github", "pullRequests"],
    fix: fixes("sudo apt install gh", "https://cli.github.com"),
  }),
);

/** Hooks, the allowed folders and the service lack: the three fixes a click does. */
const FIXABLE: DepsResult = healthy(
  dep("hooks", "required", "missing", { breaks: ["liveStatus"] }),
  dep("folders", "required", "missing", { breaks: ["projects"] }),
  dep("service", "required", "missing", {
    breaks: ["autostart"],
    fix: (["linux", "darwin", "win32"] as const).map((os) => ({ os, command: SERVICE_COMMAND })),
  }),
);

/** A path longer than a narrow row, as a global install under a package manager's store can be. */
const LONG_PATH =
  "/home/demo/.local/share/pnpm/global/5/.pnpm/@anthropic-ai+claude-code@2.1.4/node_modules/@anthropic-ai/claude-code/cli.js";
/** `FIXABLE` once the service is on. */
const serviceOn: DepsResult = {
  items: FIXABLE.items.map((item) =>
    item.id === "service" ? dep("service", "required", "ok") : item,
  ),
};

const ALL_OK: DepsResult = healthy(
  dep("claude", "required", "ok", { version: "2.1.4", path: LONG_PATH }),
);

/** The read of each kind that worked, and every one after it refused. */
const REFUSED_AFTER = "The host did not answer.";
const failsAfterFirst: WireRule[] = [
  { command: "deps.check", as: "deps.check", data: healthy(), afterRefuse: REFUSED_AFTER },
  { command: "doctor.run", as: "doctor.run", data: DOCTOR, afterRefuse: REFUSED_AFTER },
];

/** Waits for a read that worked, then puts the panel at the top. */
async function read(page: Page): Promise<void> {
  await panel(page).getByText(COUNTS).waitFor();
  await showHealth(page);
}

/** The Turn on start at boot row's dialog, open. */
async function openService(page: Page): Promise<void> {
  await read(page);
  await panel(page).getByRole("button", { name: TURN_ON_ROW }).click();
  await page.getByRole("alertdialog").waitFor();
}

export function healthShots(_ids: DemoIds): Shot[] {
  return [
    {
      // A required tool missing and one outdated, each with its command to copy and the Install page.
      name: "host-saude-falta",
      route: { name: "host", host: ALFA },
      wire: answers(MISSING),
      prepare: read,
    },
    {
      // The first read has not answered: the panel says Checking and shows no row.
      name: "host-saude-lendo",
      route: { name: "host", host: ALFA },
      wire: [
        { command: "deps.check", hold: true },
        { command: "doctor.run", hold: true },
      ],
      prepare: async (page) => {
        await panel(page).getByText(CHECKING).waitFor();
        await showHealth(page);
      },
    },
    {
      // A read that fails after a good one: the reason, and the rows of the good read behind it.
      name: "host-saude-leitura-falhou",
      route: { name: "host", host: ALFA },
      wire: failsAfterFirst,
      prepare: async (page) => {
        await panel(page).getByText(COUNTS).waitFor();
        await panel(page).getByRole("button", { name: CHECK_AGAIN }).click();
        await panel(page).getByText(READ_FAILED).waitFor();
        await showHealth(page);
      },
    },
    {
      // The three rows that fix in one click: Install hooks, Add folder and Turn on start at boot.
      name: "host-saude-correcoes",
      route: { name: "host", host: ALFA },
      wire: answers(FIXABLE),
      prepare: read,
    },
    {
      name: "host-saude-hooks-dialogo",
      route: { name: "host", host: ALFA },
      wire: answers(FIXABLE),
      prepare: async (page) => {
        await read(page);
        await panel(page).getByRole("button", { name: INSTALL_HOOKS }).click();
        await page.getByRole("alertdialog").waitFor();
      },
    },
    {
      name: "host-saude-servico-dialogo",
      route: { name: "host", host: ALFA },
      wire: answers(FIXABLE),
      prepare: openService,
    },
    {
      // The service turned on with linger off: the note and the line to copy. The host is never asked.
      name: "host-saude-boot",
      route: { name: "host", host: ALFA },
      wire: [
        // The re-read after the service is on finds it working, so the headline and the row agree with the note.
        { command: "deps.check", data: FIXABLE, after: serviceOn },
        { command: "doctor.run", data: DOCTOR },
        { command: "service.install", reply: { startsAt: "boot", lingerOff: true, user: "demo" } },
      ],
      prepare: async (page) => {
        await openService(page);
        await page.getByRole("alertdialog").getByRole("button", { name: TURN_ON }).click();
        await panel(page).getByRole("status", { name: BOOT_NOTE }).waitFor();
        // The re-read is in: the service row no longer offers to turn it on.
        await panel(page).getByRole("button", { name: TURN_ON_ROW }).waitFor({ state: "detached" });
        await showHealth(page);
      },
    },
    {
      // The folded Working list open, with a path longer than a narrow row.
      name: "host-saude-ok-aberto",
      route: { name: "host", host: ALFA },
      wire: answers(ALL_OK),
      prepare: async (page) => {
        await read(page);
        await panel(page).getByRole("button", { name: SHOW_FINE }).click();
        await panel(page).getByRole("list", { name: WORKING }).waitFor();
      },
    },
  ];
}
