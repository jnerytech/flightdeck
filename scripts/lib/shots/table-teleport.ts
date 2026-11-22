/** Part of the print table (scripts/demo-shots.ts), in print order: the Teleport dialog (#3987). */
import type { Page } from "playwright-core";
import type { DemoIds } from "../../demo-seed.ts";
import type { Shot } from "./shot.ts";

const hub = { name: "hub" as const };

/** A repository that is not on any real host: the print never moves anything. */
const REPO = "/srv/projects/flightdeck-web";

const text = (en: string, pt: string) => new RegExp(`^(${en}|${pt})$`);

/**
 * The dialog open on a session of beta: the rows are expanded and each row's menu is tried until one
 * offers "Move to another host" (only an idle session of the app's own is movable).
 */
async function openMove(page: Page): Promise<void> {
  const move = page.getByRole("menuitem", {
    name: text("Move to another host…", "Mover para outro host…"),
  });
  const actions = page.getByRole("main").locator("button[data-row-actions]");
  // The list fills in as the hosts answer: each turn expands what is there and tries every row's menu.
  for (let turn = 0; turn < 20; turn++) {
    await page
      .getByRole("button", { name: text("Expand all", "Expandir tudo") })
      .click({ timeout: 1000 })
      .catch(() => undefined);
    for (let i = 0, n = await actions.count(); i < n; i++) {
      await actions.nth(i).click();
      if (await move.isVisible().catch(() => false)) {
        await move.click();
        await page.getByRole("dialog").waitFor();
        return;
      }
      await page.keyboard.press("Escape"); // NOSONAR: one row's menu at a time, closed before the next opens
    }
    await page.waitForTimeout(500); // NOSONAR: a pause between turns, so the hosts can answer
  }
  throw new Error("no session's menu offers to move it to another host");
}

/** The first step filled in: a host picked (the first one offered, so whichever host the menu was opened on), the repository named. */
async function pickHost(page: Page): Promise<void> {
  await openMove(page);
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(text("Host", "Host")).selectOption({ index: 1 });
  await dialog.getByLabel(text("Repository on that host", "Repositório nesse host")).fill(REPO);
}

/** The summary of what moves: the branch, the files and the lines that look like secrets. */
async function preview(page: Page): Promise<void> {
  await pickHost(page);
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: text("Continue", "Continuar") }).click();
  await dialog.getByRole("button", { name: text("Move", "Mover") }).waitFor({ timeout: 15_000 });
  // Pointer away and animations over: with the dialog still growing under the pointer, axe read Move in a color under AA (#3987).
  await page.mouse.move(0, 0);
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== "running"),
  );
}

export function teleportShots(_ids: DemoIds): Shot[] {
  const on = { route: hub, teleportPreview: true };
  return [
    // The first step: pick the host and name the repository there.
    { name: "teleporte-passo-1", ...on, prepare: pickHost },
    {
      // What goes along: the branch, how far ahead of origin, the files, the size and the secrets' count.
      name: "teleporte-previa",
      ...on,
      teleport: "answers",
      prepare: preview,
    },
    {
      // The move is done: the session is on the other host, with the button that opens it there.
      name: "teleporte-feito",
      ...on,
      teleport: "answers",
      prepare: async (page) => {
        await preview(page);
        const dialog = page.getByRole("dialog");
        await dialog.getByRole("button", { name: text("Move", "Mover") }).click();
        await dialog
          .getByRole("button", { name: text("Open it there", "Abrir lá") })
          .waitFor({ timeout: 15_000 });
      },
    },
    {
      // The other host is reached over plain ws:// from a name that is not this machine's: the note says so.
      name: "teleporte-ws-aberto",
      ...on,
      query: { plain: "demo-beta" },
      prepare: async (page) => {
        await pickHost(page);
        // The plain-ws note is the app's warning notice, a polite status (#4124).
        await page.getByRole("dialog").getByRole("status").waitFor({ timeout: 15_000 });
      },
    },
    {
      // Only beta is paired (its idle session is the movable one): there is no host to move to.
      name: "teleporte-sem-destino",
      ...on,
      query: { hosts: "demo-beta" },
      prepare: async (page) => {
        await openMove(page);
        await page.getByRole("dialog").getByRole("note").waitFor({ timeout: 15_000 });
      },
    },
    {
      // The source's package is refused: the dialog says why, in its own words.
      name: "teleporte-falhou",
      ...on,
      teleport: "refuses",
      prepare: async (page) => {
        await pickHost(page);
        const dialog = page.getByRole("dialog");
        await dialog.getByRole("button", { name: text("Continue", "Continuar") }).click();
        await dialog.getByRole("alert").waitFor({ timeout: 15_000 });
      },
    },
  ];
}
