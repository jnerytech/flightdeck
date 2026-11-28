/** Part of the print table (scripts/demo-shots.ts), in print order: the Settings sections that had no print (#4435, #4436). */
import type { Page } from "playwright-core";
import type { DemoIds } from "../../demo-seed.ts";
import { type Shot, showSectionById } from "./shot.ts";

const WAIT = 15_000;
const route = { name: "settings" } as const;

/** A sound file of no length, as small as a real WAV header: the section keeps its name and its bytes. */
const SILENCE = Buffer.from(
  "524946462400000057415645666d74201000000001000100401f0000803e0000020010006461746100000000",
  "hex",
);

/** The Notifications section with a host and a project muted and a sound file chosen. */
async function notificationsSet(page: Page): Promise<void> {
  await page.getByRole("checkbox", { name: /^(Mute|Silenciar) alfa$/ }).check({ timeout: WAIT });
  await page
    .getByRole("checkbox", { name: /^(Mute|Silenciar) .+ \(alfa\)$/ })
    .first()
    .check();
  await page.locator("#notify-sound").selectOption("file");
  await page
    .getByLabel(/^(Choose a sound file|Escolher um arquivo de som)/)
    .setInputFiles({ name: "alerta.wav", mimeType: "audio/wav", buffer: SILENCE });
  await page.getByText("alerta.wav").waitFor({ timeout: WAIT });
}

/** The shortcut field's text is saved: the notice or the error it brings is on screen. */
async function shortcutSaved(page: Page, text: string): Promise<void> {
  await page.getByRole("textbox", { name: /^(Key combination|Combinação de teclas)$/ }).fill(text);
  await page.getByRole("button", { name: /^(Save shortcut|Salvar atalho)$/ }).click();
}

/** Global shortcut: one the system refuses (its notice), then one that is not a shortcut (the field's error). */
async function shortcutRefused(page: Page): Promise<void> {
  await shortcutSaved(page, "Ctrl+Alt+G");
  await page
    .getByText(/(could not be registered|não pôde ser registrado)/)
    .waitFor({ timeout: WAIT });
  await shortcutSaved(page, "Ctrl+Alt+Nothing");
  await page.getByText(/(expected format|formato esperado)/).waitFor({ timeout: WAIT });
}

/** Updates: "Check for updates now" is pressed, and the answer (`answer`) is on screen. */
async function updateChecked(page: Page, answer: RegExp): Promise<void> {
  await page
    .getByRole("button", { name: /^(Check for updates now|Procurar atualização agora)$/ })
    .click({ timeout: WAIT });
  await page.getByText(answer).first().waitFor({ timeout: WAIT });
}

export function settingsShots(_ids: DemoIds): Shot[] {
  return [
    { name: "configuracoes-janela", route, prepare: showSectionById("window") },
    {
      // A host and a project muted, and a sound file chosen: the rows the section grows with.
      name: "configuracoes-notificacoes",
      route,
      prepare: async (page) => {
        await showSectionById("notifications")(page);
        await notificationsSet(page);
        await showSectionById("notifications")(page);
      },
    },
    {
      // The demo's platform has a shortcut the system refuses (`shortcut=taken`).
      name: "configuracoes-atalho",
      route,
      query: { shortcut: "taken" },
      prepare: async (page) => {
        await showSectionById("shortcut")(page);
        await shortcutRefused(page);
        await showSectionById("shortcut")(page);
      },
    },
    {
      // A host that answers as a far connection: the section says so, and its fields are disabled.
      name: "configuracoes-vigiar",
      route,
      wire: [{ command: "host.info", set: { near: false } }],
      prepare: async (page) => {
        await page
          .getByText(/^(The checks and the check loop|Os checks e o laço de checks)/)
          .first()
          .waitFor({ timeout: WAIT });
        await showSectionById("watch")(page);
      },
    },
    {
      name: "configuracoes-atualizacoes-ok",
      route,
      query: { update: "none" },
      prepare: async (page) => {
        await showSectionById("updates")(page);
        await updateChecked(
          page,
          /^(You are on the latest version|Você está na versão mais recente)$/,
        );
      },
    },
    {
      name: "configuracoes-atualizacoes-falhou",
      route,
      query: { update: "fail" },
      prepare: async (page) => {
        await showSectionById("updates")(page);
        await updateChecked(page, /The update server did not answer/);
      },
    },
    {
      // The demo's platform has a log file (`logs=demo`): the section is there, as in the desktop app.
      name: "configuracoes-diagnostico",
      route,
      query: { logs: "demo" },
      prepare: showSectionById("diagnostics"),
    },
  ];
}
