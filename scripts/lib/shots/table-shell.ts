/** Part of the print table (scripts/demo-shots.ts), in print order. */
import type { Page } from "playwright-core";
import type { DemoIds } from "../../demo-seed.ts";
import { ALFA, type Shot, showToast } from "./shot.ts";

/** #4059: the account menu's What's new item opens the dialog; each print then waits for what it shows. */
async function openWhatsNew(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: /^(Account menu for|Menu da conta de) / })
    .click({ timeout: 8000 });
  await page.getByRole("menuitem", { name: /^(What's new|Novidades)/ }).click({ timeout: 8000 });
  await page.getByRole("dialog").waitFor({ timeout: 8000 });
}

export function shellShots(ids: DemoIds): Shot[] {
  return [
    { name: "hub", route: { name: "hub" } },
    // Issue #581: a toast sits over the status bar, 0.75rem clear of it, like the update card.
    { name: "aviso-barra", route: { name: "hub" }, prepare: showToast },
    // ...and over the update card while it shows, never on it.
    {
      name: "aviso-atualizacao",
      route: { name: "hub" },
      query: { update: "9.9.9" },
      async prepare(page) {
        await page.locator('[data-slot="update-card"]').waitFor();
        await showToast(page);
      },
    },
    {
      // #4059: an offered version with the automatic update off: the banner above the screen.
      name: "atualizacao-faixa",
      route: { name: "hub" },
      query: { update: "9.9.9" },
      autoUpdateOff: true,
      async prepare(page) {
        await page
          .getByRole("region", { name: /^(App update|Atualização do app)$/ })
          .waitFor({ timeout: 8000 });
      },
    },
    {
      // #4059: the check fails: the banner says what went wrong and offers Settings.
      name: "atualizacao-faixa-erro",
      route: { name: "hub" },
      query: { update: "fail" },
      async prepare(page) {
        await page
          .getByRole("alert")
          .filter({
            hasText: /^(The update check did not finish|A verificação de atualização não terminou)/,
          })
          .waitFor({ timeout: 8000 });
      },
    },
    {
      // #4059: What's new while the notes are being read.
      name: "novidades-carregando",
      route: { name: "hub" },
      releases: "loading",
      async prepare(page) {
        await openWhatsNew(page);
        await page
          .getByText(/^(Reading the release notes|Lendo as notas de versão)/)
          .waitFor({ timeout: 8000 });
      },
    },
    {
      // #4059: no host can read the notes.
      name: "novidades-vazio",
      route: { name: "hub" },
      releases: "none",
      async prepare(page) {
        await openWhatsNew(page);
        await page
          .getByText(/^(No connected host can read|Nenhum host conectado consegue ler)/)
          .waitFor({ timeout: 8000 });
      },
    },
    {
      // #4059: the host refuses: the reason and Try again.
      name: "novidades-erro",
      route: { name: "hub" },
      releases: "error",
      async prepare(page) {
        await openWhatsNew(page);
        await page
          .getByRole("button", { name: /^(Try again|Tentar de novo)$/ })
          .waitFor({ timeout: 8000 });
      },
    },
    {
      // #4059: the list, one release with no highlights; re-measured narrow, where the footer is a column.
      name: "novidades",
      route: { name: "hub" },
      releases: "list",
      async prepare(page) {
        await openWhatsNew(page);
        await page.getByRole("list", { name: /^(Releases|Versões)$/ }).waitFor({ timeout: 8000 });
      },
    },
    {
      // Precisa de você with the Bash request chosen: its command, folder, age and buttons.
      name: "precisa-de-voce",
      finished: true,
      route: { name: "needs-you" },
      prepare: async (page) => {
        const request = page.getByRole("button", { name: /Testes do backend: Bash/ });
        await request.click();
        await page.waitForTimeout(500);
      },
    },
    {
      // Issue #1344: Needs you after a long absence: the summary above the list.
      name: "precisa-de-voce-fora",
      away: true,
      route: { name: "needs-you" },
      prepare: async (page) => {
        await page
          .getByRole("region", { name: /^(While you were away|Enquanto você esteve fora)$/ })
          .waitFor({ timeout: 8000 });
      },
    },
    {
      // The sidebar as a 56 px rail of icons.
      name: "barra-recolhida",
      route: { name: "hub" },
      prepare: async (page) => {
        await page
          .getByRole("button", { name: /^(Recolher barra lateral|Collapse sidebar)$/ })
          .click();
        await page.waitForTimeout(400);
      },
    },
    { name: "sessao-aprovacao", route: { name: "session", host: ALFA, id: ids.waitingSession } },
    { name: "sessao", route: { name: "session", host: ALFA, id: ids.idleSession } },
    // The form with its Criar sessão off and the reason beside it.
    { name: "nova-sessao", route: { name: "new-session", host: ALFA } },
    // The folder dialog over the form: centered, with the page dimmed behind it.
    {
      name: "pasta-escolher",
      route: { name: "new-session", host: ALFA },
      async prepare(page) {
        await page.getByRole("button", { name: /^(Procurar|Browse)/ }).click();
        await page.getByRole("dialog").waitFor();
      },
    },
    // The tab strip with twenty tabs: it scrolls, keeps each width and offers the menu of all.
    {
      name: "abas-muitas",
      route: { name: "hub" },
      async prepare(page) {
        for (let i = 0; i < 20; i++) {
          await page.keyboard.press("Control+t"); // NOSONAR: key presses reach the page in the order typed
          await page.keyboard.press("Escape"); // NOSONAR: the tab opens first, then closes its menu
        }
        await page.getByRole("button", { name: /^(Todas as abas|All tabs)( \(|$)/ }).waitFor();
      },
    },
    // The list of all tabs open over that strip (#576): icons, hosts, the active one marked.
    {
      name: "abas-lista",
      route: { name: "hub" },
      async prepare(page) {
        for (let i = 0; i < 20; i++) {
          await page.keyboard.press("Control+t"); // NOSONAR: key presses reach the page in the order typed
          await page.keyboard.press("Escape"); // NOSONAR: the tab opens first, then closes its menu
        }
        await page.getByRole("button", { name: /^(Todas as abas|All tabs)( \(|$)/ }).click();
        await page.getByRole("listbox", { name: /^(Todas as abas|All tabs)$/ }).waitFor();
      },
    },
    // #4122: the sheet of keyboard shortcuts, opened by the ? key as a person does, so axe and the layout checks see it.
    {
      name: "atalhos",
      route: { name: "hub" },
      async prepare(page) {
        await page.keyboard.press("?");
        await page
          .getByRole("dialog", { name: /^(Keyboard shortcuts|Atalhos de teclado)$/ })
          .waitFor({ timeout: 8000 });
      },
    },
  ];
}
