/** Part of the print table (scripts/demo-shots.ts), in print order. */
import type { DemoIds } from "../../demo-seed.ts";
import { ALFA, type Shot, showToast } from "./shot.ts";

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
  ];
}
