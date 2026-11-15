/** Part of the print table (scripts/demo-shots.ts), in print order. */
import type { DemoIds } from "../../demo-seed.ts";
import { DEMO_UPDATE_CARDS } from "../e2e/journeys.ts";
import { ALFA, type Shot, selectCards } from "./shot.ts";

export function boardShots(ids: DemoIds): Shot[] {
  return [
    { name: "board", route: { name: "board", host: ALFA, projectId: ids.project } },
    // #1354: four cards selected (three to start, one at a gate): the bar's Start N and Stop N, the
    // checks on every card, and at 390 the compact bar with Move to and Discard under ⋯.
    {
      name: "board-selecao",
      route: { name: "board", host: ALFA, projectId: ids.project },
      prepare: selectCards,
    },
    // ...and Start N's confirm: the host's queue, its quota, its memory and budget holds (#1414)
    // and the card it skips.
    {
      name: "board-selecao-iniciar",
      route: { name: "board", host: ALFA, projectId: ids.project },
      holds: true,
      prepare: async (page) => {
        await selectCards(page);
        await page
          .getByRole("group", { name: /^(Selection|Seleção)$/ })
          .getByRole("button", { name: /^(Start|Iniciar) \d+$/ })
          .click();
        await page.locator('[role="alertdialog"]').waitFor();
        // The host's limit comes from project.list after the dialog opens, its memory after it.
        await page.locator('[role="alertdialog"] p').first().waitFor();
        await page
          .locator('[role="alertdialog"]')
          .getByText(/(memory|memória)/)
          .first()
          .waitFor();
        await page
          .locator('[role="alertdialog"]')
          .getByText(/(budget|orçamento)/)
          .first()
          .waitFor();
        await page.waitForTimeout(400);
      },
    },
    // #1406: Update 3 from the base on the billing cards: the summary names the updated (or already
    // current) cards and the one in conflict, which stays selected on the bar.
    {
      name: "board-atualizar",
      route: { name: "board", host: ALFA, projectId: ids.updateProject },
      async prepare(page) {
        for (const title of DEMO_UPDATE_CARDS) {
          await page // NOSONAR: one Ctrl-click after the other, so each adds to the selection the last one left
            .locator("li[data-card]", { hasText: title })
            .first()
            .click({ modifiers: ["Control"], position: { x: 40, y: 4 } });
        }
        await page
          .getByRole("group", { name: /^(Selection|Seleção)$/ })
          .getByRole("button", { name: /^(Update 3 from the base|Atualizar 3 com a base)$/ })
          .click();
        // The board's status line repeats the notice for a screen reader: either one will do.
        await page
          .getByText(/(Conflict, left as it was|Conflito, ficou como estava)/)
          .first()
          .waitFor();
      },
    },
    // #117: the files of a worktree picked in the sidebar tree, in a panel beside the columns.
    {
      name: "board-arquivos",
      route: { name: "board", host: ALFA, projectId: ids.project },
      async prepare(page) {
        const tree = page.locator("[data-slot=project-tree]");
        const head = tree.locator('[data-project="flightdeck-web"]');
        if ((await head.getAttribute("aria-expanded")) === "false") await head.click();
        await tree.getByRole("button", { name: /fd\/revisar-o-fluxo-de-login/ }).click();
        await page.locator("[data-slot=board-files]").getByText("app.ts").waitFor();
      },
    },
    // #812: a pressed toggle (Blocked) looks pressed, in fill and in a ring, beside unpressed ones.
    {
      name: "board-bloqueados",
      route: { name: "board", host: ALFA, projectId: ids.project },
      async prepare(page) {
        const blocked = page.getByRole("button", { name: /^(Bloqueados|Blocked)$/ });
        await blocked.click();
        // Blocked itself, pressed: another toggle on the page (Files) could already be.
        await page
          .locator('[data-slot="button"][aria-pressed="true"]')
          .filter({ hasText: /^(Bloqueados|Blocked)$/ })
          .waitFor();
      },
    },
    // #117: a content search in that panel, each match as path:line with its line.
    {
      name: "board-arquivos-busca",
      route: { name: "board", host: ALFA, projectId: ids.project },
      async prepare(page) {
        const tree = page.locator("[data-slot=project-tree]");
        const head = tree.locator('[data-project="flightdeck-web"]');
        if ((await head.getAttribute("aria-expanded")) === "false") await head.click();
        await tree.getByRole("button", { name: /fd\/revisar-o-fluxo-de-login/ }).click();
        const panel = page.locator("[data-slot=board-files]");
        await panel.getByRole("button", { name: /^(Conteúdo|Content)$/ }).click();
        await panel.getByRole("searchbox").fill("export");
        await panel.getByText("app.ts:1").waitFor();
      },
    },
    {
      name: "card",
      route: { name: "card", host: ALFA, projectId: ids.project, cardId: ids.diffCard },
    },
    // Phase 31: the detail of the last card of a chain, and the refusal of its start.
    {
      // Opened from the board: a card in the Backlog is only known to the app once its board is.
      name: "card-bloqueado",
      route: { name: "board", host: ALFA, projectId: ids.project },
      prepare: async (page) => {
        await page.getByRole("button", { name: "Tela do carrinho", exact: true }).click();
        await page.getByRole("region", { name: /^(Bloqueado por|Blocked by)$/ }).waitFor();
        await page.waitForTimeout(400);
      },
    },
    {
      name: "board-inicio-recusado",
      route: { name: "board", host: ALFA, projectId: ids.project },
      prepare: async (page) => {
        await page
          .getByRole("button", { name: /^(Ações de|Actions for) Tela do carrinho$/ })
          .click();
        await page.getByRole("menuitem", { name: /^(Iniciar card|Start card)$/ }).click();
        await page.waitForTimeout(600);
      },
    },
    {
      // The card's Mudanças tab: files, numbered diff and the composer open on a line.
      name: "card-mudancas",
      route: { name: "card", host: ALFA, projectId: ids.project, cardId: ids.diffCard },
      prepare: async (page) => {
        await page.getByRole("button", { name: /^(Mudanças|Changes)$/ }).click();
        await page
          .getByRole("button", {
            name: /^(Comentar a linha 1 de fake-1.txt|Comment on line 1 of fake-1.txt)$/,
          })
          .click();
        await page.waitForTimeout(500);
      },
    },
    {
      // #1446: the card's Mudanças tab after a second-opinion review: its summary, the finding on
      // no changed line, and the reviewer drafts with their severity.
      name: "card-segunda-opiniao",
      route: { name: "card", host: ALFA, projectId: ids.project, cardId: ids.diffCard },
      prepare: async (page) => {
        await page.getByRole("button", { name: /^(Mudanças|Changes)$/ }).click();
        await page
          .getByRole("button", { name: /^(Pedir uma segunda opinião|Get a second opinion)$/ })
          .click();
        await page
          .getByText("Two findings on the changes, one general note.", { exact: true })
          .waitFor();
        await page.waitForTimeout(500);
      },
    },
    {
      // A session's Mudanças tab: the repository's working tree against HEAD.
      name: "sessao-mudancas",
      route: { name: "session", host: ALFA, id: ids.idleSession },
      prepare: async (page) => {
        await page.getByRole("tab", { name: /^(Mudanças|Changes)$/ }).click();
        await page.waitForTimeout(800);
      },
    },
    {
      name: "card-gate",
      route: { name: "card", host: ALFA, projectId: ids.project, cardId: ids.gateCard },
    },
    { name: "historico", route: { name: "history", host: ALFA } },
    {
      name: "leitor-longo",
      route: { name: "reader", target: { hostId: ALFA, claudeSessionId: "hist-longo" } },
    },
  ];
}
