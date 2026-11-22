/** Part of the print table (scripts/demo-shots.ts), in print order. */
import { formatPairingLink } from "@flightdeck/protocol";
import type { Page } from "playwright-core";
import type { DemoIds } from "../../demo-seed.ts";
import { DEMO_CARD_TEMPLATE } from "../demo/card-templates.ts";
import { DEMO_PR_CARD, DEMO_PR_URL, DEMO_TEAM_REPORT } from "../e2e/journeys.ts";
import { keepSaves, offerBackup } from "./save-file.ts";
import { ALFA, openHostSettings, type Shot, showSection, showToast } from "./shot.ts";

/** Opens one of the vault's tabs and waits for its panel to settle. */
function vaultTab(name: string | RegExp): NonNullable<Shot["prepare"]> {
  return async (page) => {
    await page.getByRole("tab", { name }).click();
    await page.getByRole("tabpanel").waitFor();
  };
}

/** Connections, once its destinos are in the list. */
async function listed(page: Page): Promise<void> {
  await page.getByRole("list", { name: /^(Destinations|Destinos)$/ }).waitFor();
}

const SUBMIT = /^(Test and add|Testar e adicionar)$/;

/** Settings > Backup: the passphrase of a new backup, typed and repeated (#4001). */
async function fillExport(page: Page): Promise<void> {
  const phrase = "a long enough passphrase";
  await page.getByLabel(/^(Passphrase|Frase-senha)$/).fill(phrase);
  await page.getByLabel(/^(Confirm passphrase|Confirmar frase-senha)$/).fill(phrase);
}

const BACKUP_PHRASE = "a long enough passphrase";
const READ = /^(Read backup|Ler backup)$/;
const KEEP = /^(Keep what is here|Manter o que está aqui)$/;
const RESTORE = /^(Restore|Restaurar)$/;

/**
 * Settings > Backup, with a backup of the demo's personas taken and then edited, so reading it back
 * finds one persona new here and one different (#4001). `keepSaves` keeps the file the save dialog
 * would take, and `offerBackup` hands it to the file input the Restore a backup form opens.
 */
async function backedUpThenEdited(page: Page): Promise<void> {
  const personas = (list: Array<{ id: string; name: string }>) =>
    page.evaluate(
      `localStorage.setItem("flightdeck.personas", ${JSON.stringify(JSON.stringify(list))})`,
    );
  await page.evaluate(`(${keepSaves.toString()})(window)`);
  await page.evaluate(`(${offerBackup.toString()})(window)`);
  await personas([
    { id: "p-review", name: "Reviewer" },
    { id: "p-write", name: "Writer" },
  ]);
  await fillExport(page);
  await page.getByRole("button", { name: /^(Back up now|Fazer backup agora)$/ }).click();
  await page.getByText(/^(Backup saved|Backup salvo)/).waitFor();
  await personas([{ id: "p-review", name: "Reviewer (edited)" }]);
}

/** Types the file's passphrase and reads the backup: the preview shows with Keep chosen. */
async function readBackup(page: Page, phrase = BACKUP_PHRASE): Promise<void> {
  await page.getByLabel(/^(File passphrase|Frase-senha do arquivo)$/).fill(phrase);
  await page.getByRole("button", { name: READ }).click();
}

export function hostShots(ids: DemoIds): Shot[] {
  return [
    {
      // The host's Health & dependencies section, scrolled into view so its colors can be judged.
      name: "host-saude",
      route: { name: "host", host: ALFA },
      prepare: showSection(/^(Health & dependencies|Saúde e dependências)$/),
    },
    {
      // #1501: the Compare hosts table opened on alfa's page, with the demo's other hosts beside it.
      // #1520: alfa and beta agree and gama differs (Start at boot), so a cell is marked.
      name: "host-comparar",
      route: { name: "host", host: ALFA },
      prepare: async (page) => {
        await page.getByRole("button", { name: /^(Mostrar comparação|Show comparison)$/ }).click();
        await page.waitForTimeout(1500);
        await showSection(/^(Compare hosts|Comparar hosts)$/)(page);
      },
    },
    {
      name: "host-manutencao",
      route: { name: "host", host: ALFA },
      prepare: async (page) => {
        await openHostSettings(page);
        await showSection(/^(Maintenance|Manutenção)$/)(page);
      },
    },
    // #3943: SSH Connections. The hosts' answers are replaced in the page (`sshScript`): the demo's real
    // daemons would show the machine's own ssh config and never ask for a password.
    {
      name: "ssh-destinos",
      route: { name: "connections" },
      ssh: true,
      prepare: listed,
    },
    {
      name: "ssh-novo",
      route: { name: "connections" },
      ssh: true,
      prepare: async (page) => {
        await listed(page);
        await page.getByRole("button", { name: /^(New destination|Novo destino)$/ }).click();
        await page.getByRole("button", { name: /^(Save destination|Salvar destino)$/ }).waitFor();
      },
    },
    {
      name: "ssh-importar",
      route: { name: "connections" },
      ssh: true,
      prepare: async (page) => {
        await listed(page);
        await page
          .getByRole("button", { name: /^(Import from SSH config|Importar do SSH config)$/ })
          .click();
        await page.getByRole("checkbox", { name: "lab-box" }).waitFor();
      },
    },
    {
      name: "ssh-askpass",
      route: { name: "connections" },
      ssh: true,
      askpass: true,
      prepare: async (page) => {
        // The open dialog hides the list from the accessibility tree: its rows are found by their text.
        await page.getByText("docs-site", { exact: true }).waitFor();
        await page.getByRole("alertdialog").waitFor();
      },
    },
    // #3602: the vault's views. The seeded list has no values (the web build keeps them in memory).
    { name: "cofre-segredos", route: { name: "vault" }, secrets: true },
    // No secret stored: the empty state with its action.
    { name: "cofre-vazio", route: { name: "vault" } },
    {
      name: "cofre-novo",
      route: { name: "vault" },
      secrets: true,
      prepare: async (page) => {
        await page.getByRole("button", { name: /^(New secret|Novo segredo)$/ }).click();
        await page.getByRole("textbox").first().waitFor();
      },
    },
    {
      // The typed confirmation, its word field empty and the Reveal button off.
      name: "cofre-revelar",
      route: { name: "vault" },
      secrets: true,
      prepare: async (page) => {
        await page.getByRole("button", { name: /^(Reveal|Revelar) github-deploy$/ }).click();
        await page.getByRole("alertdialog").waitFor();
      },
    },
    {
      // #3944: a value to copy. The seeded list has none (the web build keeps values in memory), so the
      // print stores one, then copies it; the toast says "Copied". The clipboard is the page's to write.
      name: "cofre-copiar",
      route: { name: "vault" },
      prepare: async (page) => {
        const context = page.context();
        await context.grantPermissions(["clipboard-read", "clipboard-write"]);
        try {
          await page.getByRole("button", { name: /^(New secret|Novo segredo)$/ }).click();
          await page.getByLabel(/^(Name|Nome)$/).fill("demo-token");
          await page.getByLabel(/^(Value|Valor)$/).fill("demo-not-a-real-token");
          await page.getByRole("button", { name: /^(Save|Guardar)$/ }).click();
          await page.getByRole("button", { name: /^(Copy|Copiar) demo-token$/ }).click();
          await page.getByText(/^(Copied|Copiado)$/).waitFor();
          // timing: sonner's enter animation (400 ms) ends before the shot.
          await page.waitForTimeout(500);
        } finally {
          // The permission was for the copy: the context's later prints do not keep it.
          await context.clearPermissions();
        }
      },
    },
    {
      // #3944: Edit opens the secret's name, description, tags and hosts.
      name: "cofre-editar",
      route: { name: "vault" },
      secrets: true,
      prepare: async (page) => {
        await page.getByRole("button", { name: /^(Edit|Editar) github-deploy$/ }).click();
        await page.getByLabel(/^(Name|Nome)$/).waitFor();
      },
    },
    {
      // #3944: the Rules editor of a secret, with its first rule empty.
      name: "cofre-regras",
      route: { name: "vault" },
      secrets: true,
      prepare: async (page) => {
        await page.getByRole("button", { name: /^(Rules of|Regras de) github-deploy$/ }).click();
        await page.getByRole("heading", { name: /^(Rules of|Regras de) github-deploy$/ }).waitFor();
      },
    },
    {
      // #3944: Remove asks for the secret's name, typed, and the button stays off until it matches.
      name: "cofre-remover",
      route: { name: "vault" },
      secrets: true,
      prepare: async (page) => {
        await page.getByRole("button", { name: /^(Remove|Remover) github-deploy$/ }).click();
        await page.getByRole("alertdialog").waitFor();
      },
    },
    {
      name: "cofre-uso",
      route: { name: "vault" },
      secrets: true,
      vaultUsage: true,
      prepare: vaultTab(/^(Usage|Uso)$/),
    },
    { name: "cofre-backup", route: { name: "vault" }, prepare: vaultTab("Backup") },
    {
      name: "cofre-relatorio",
      route: { name: "vault" },
      prepare: vaultTab(/^(Report|Relatório)$/),
    },
    {
      // #1328: Settings > Backup schedule, with the demo's folder (#1309): every day, the folder
      // chosen, and the run that is due waiting for the passphrase. The web build has no folder.
      name: "configuracoes-backup-agenda",
      route: { name: "settings", section: "backup" },
      query: { backupFolder: "demo" },
      prepare: async (page) => {
        await page.getByRole("radio", { name: /^(Every day|Todo dia)$/ }).check();
        await page.getByRole("button", { name: /^(Choose folder|Escolher pasta)$/ }).click();
        await page.getByText("/demo/backups").first().waitFor();
        await showSection(/^(Scheduled backups|Backups agendados)$/)(page);
      },
    },
    {
      // #4001: Back up everything, the passphrase typed and repeated, so Back up now is on.
      name: "configuracoes-backup-exportar",
      route: { name: "settings", section: "backup" },
      prepare: async (page) => {
        await fillExport(page);
        await showSection(/^(Back up everything|Backup de tudo)$/)(page);
      },
    },
    {
      // #4001: the same form after Back up now: the page keeps the file the save dialog would take
      // (`keepSaves`), and the panel says the backup was saved.
      name: "configuracoes-backup-salvo",
      route: { name: "settings", section: "backup" },
      prepare: async (page) => {
        await page.evaluate(`(${keepSaves.toString()})(window)`);
        await fillExport(page);
        await page.getByRole("button", { name: /^(Back up now|Fazer backup agora)$/ }).click();
        await page.getByText(/^(Backup saved|Backup salvo)/).waitFor();
        await showSection(/^(Back up everything|Backup de tudo)$/)(page);
      },
    },
    {
      // #4001: Restore a backup after Read backup: what is new here, what differs, Keep chosen.
      name: "configuracoes-backup-ler",
      route: { name: "settings", section: "backup" },
      prepare: async (page) => {
        await backedUpThenEdited(page);
        await readBackup(page);
        await page.getByRole("radio", { name: KEEP }).waitFor();
        await showSection(/^(Restore a backup|Restaurar um backup)$/)(page);
      },
    },
    {
      // #4001: Replace chosen and Restore pressed: the dialog that says what is lost.
      name: "configuracoes-backup-substituir",
      route: { name: "settings", section: "backup" },
      prepare: async (page) => {
        await backedUpThenEdited(page);
        await readBackup(page);
        await page
          .getByRole("radio", { name: /^(Replace with the backup|Substituir pelo backup)$/ })
          .check();
        await page.getByRole("button", { name: RESTORE }).click();
        await page.getByRole("button", { name: /^(Replace|Substituir)$/ }).waitFor();
      },
    },
    {
      // #4001: Keep chosen and Restore pressed: the line with what came back and what was kept.
      name: "configuracoes-backup-restaurado",
      route: { name: "settings", section: "backup" },
      prepare: async (page) => {
        await backedUpThenEdited(page);
        await readBackup(page);
        await page.getByRole("button", { name: RESTORE }).click();
        await page.getByText(/^(Restored|Restaurado):/).waitFor();
        await showSection(/^(Restore a backup|Restaurar um backup)$/)(page);
      },
    },
    {
      // #4001: a wrong passphrase: the error line, and nothing read.
      name: "configuracoes-backup-ler-erro",
      route: { name: "settings", section: "backup" },
      prepare: async (page) => {
        await backedUpThenEdited(page);
        await readBackup(page, "not the passphrase at all");
        await page
          .getByText(/^(The file could not be read|Não foi possível ler o arquivo)/)
          .waitFor();
        await showSection(/^(Restore a backup|Restaurar um backup)$/)(page);
      },
    },
    // Phase 29: the clients' screen, the switcher open, Sessões for one client, and Custos by client.
    { name: "clientes", route: { name: "clients" }, clients: {} },
    {
      name: "seletor-de-clientes",
      route: { name: "hub" },
      clients: {},
      prepare: async (page) => {
        await page.getByRole("button", { name: /^(Cliente|Client): / }).click();
        await page.waitForTimeout(400);
      },
    },
    { name: "sessoes-do-cliente", route: { name: "hub" }, clients: { selected: "acme" } },
    {
      name: "custos-por-cliente",
      route: { name: "costs" },
      clients: {},
      // The data scope is every host by default (#126), so this is the all-hosts view as it opens.
      prepare: async (page) => {
        await page.waitForTimeout(1500);
      },
    },
    { name: "simples-inicio", route: { name: "hub" }, simple: true },
    {
      name: "simples-tarefa-espera",
      route: { name: "hub" },
      simple: true,
      prepare: async (page) => {
        await page
          .getByRole("button", { name: /Testes do backend/ })
          .first()
          .click();
        // The pointer stays where the click was, over the new screen's button: its hover color
        // is not the one the print (and the contrast check) should see.
        await page.mouse.move(1000, 700);
        await page.waitForTimeout(800);
      },
    },
    {
      name: "simples-tarefa-pronta",
      route: { name: "hub" },
      simple: true,
      prepare: async (page) => {
        await page
          .getByRole("button", { name: /Revisão do PR 128/ })
          .first()
          .click();
        // The pointer stays where the click was, over the new screen's button: its hover color
        // is not the one the print (and the contrast check) should see.
        await page.mouse.move(1000, 700);
        await page.waitForTimeout(800);
      },
    },
    {
      name: "paleta",
      route: { name: "hub" },
      prepare: async (page) => {
        await page.keyboard.press("Control+K");
        await page.waitForTimeout(800);
      },
    },
    // The hard states.
    { name: "host-offline", route: { name: "host", host: "demo-offline" } },
    { name: "host-reconectando", route: { name: "host", host: "demo-slow" } },
    { name: "host-incompativel", route: { name: "host", host: "demo-old" } },
    {
      // Issue #105: the project page with its session tiles; it fails if no tile shows.
      name: "projeto-blocos",
      route: { name: "project", host: ALFA, projectId: ids.project },
      prepare: async (page) => {
        await page.locator("[data-slot='session-tile']").first().waitFor({ timeout: 15_000 });
      },
    },
    {
      // Issue #669: the Board screen of a host, its projects as cards with their counts.
      name: "board-projetos",
      route: { name: "projects", host: ALFA, focus: "board" },
      prepare: async (page) => {
        await page.locator("[data-slot='board-card']").first().waitFor({ timeout: 15_000 });
      },
    },
    {
      name: "projeto-vazio",
      route: { name: "board", host: ALFA, projectId: ids.emptyProject },
    },
    {
      name: "lista-longa-fim",
      route: { name: "hub" },
      prepare: async (page) => {
        // Every scrolling box to its end: the last row must show.
        await page.evaluate(() => {
          for (const el of document.querySelectorAll<HTMLElement>("*")) {
            if (el.scrollHeight > el.clientHeight + 4) el.scrollTop = el.scrollHeight;
          }
        });
        await page.waitForTimeout(300);
      },
    },
    // #168: the screens shipped on 2026-11-06 and 07, in both themes and languages, with axe and the
    // layout guards (the narrow ones in NARROW_SHOTS).
    // #1052: the onboarding journey as a new person meets it: the first run (no host stored yet) and
    // Add host once a host exists. Both wait for their title, so a print never shows the screen before.
    {
      name: "primeira-execucao",
      route: { name: "add-host" },
      query: { hosts: "none" },
      async prepare(page) {
        await page
          .getByRole("heading", { name: /^(Connect your first host|Conecte seu primeiro host)$/ })
          .waitFor();
      },
    },
    {
      name: "host-novo",
      route: { name: "add-host" },
      async prepare(page) {
        await page.getByRole("heading", { name: /^(Add a host|Adicionar um host)$/ }).waitFor();
      },
    },
    {
      // #3886: Test and add pressed on the empty form: each empty field says what it needs, the first has the focus.
      name: "host-novo-campos",
      route: { name: "add-host" },
      async prepare(page) {
        await page.getByRole("button", { name: SUBMIT }).click();
        await page.getByText(/^(Fill in the name\.|Preencha o nome\.)$/).waitFor();
      },
    },
    {
      // #3886: the first demo host's own link with a wrong token, on the first-run page (no host listed, so the
      // address is not a duplicate): the daemon refuses it and the page says to run `flightdeckd pair` again.
      name: "host-novo-recusado",
      route: { name: "add-host" },
      query: { hosts: "none" },
      async prepare(page) {
        const link = formatPairingLink({
          ...ids.alfaPairing,
          name: "orange-pi",
          token: "wrong-token",
        });
        await page.getByLabel(/^(Pairing link|Link de pareamento)$/).fill(link);
        await page.getByRole("button", { name: SUBMIT }).click();
        await page.getByText(/^(Token refused|Token recusado):/).waitFor({ timeout: 15_000 });
      },
    },
    {
      // #931: New project on the Projects page, open.
      name: "projetos-novo",
      route: { name: "all-projects" },
      async prepare(page) {
        await page.getByRole("button", { name: /^(New project|Novo projeto)$/ }).click();
        // The page shows the switcher's host (#948): one host opens its form, several ask which first.
        await page.getByRole("menu").or(page.getByRole("dialog")).first().waitFor();
      },
    },
    {
      // #934: deleting the demo's closed team asks first.
      name: "times-apagar",
      route: { name: "teams", host: ALFA },
      async prepare(page) {
        await page.getByRole("button", { name: /^(Actions for|Ações de) closed-crew$/ }).click();
        await page.getByRole("menuitem", { name: /^(Delete team|Excluir time)$/ }).click();
        await page.getByRole("alertdialog").waitFor();
      },
    },
    {
      // #1222: the new-team form with its two worker rows; narrow, each row stacks with the
      // persona on its own line.
      name: "times-novo",
      route: { name: "teams", host: ALFA },
      async prepare(page) {
        await page.getByRole("button", { name: /^(New team|Novo time)$/ }).click();
        const workers = page.getByRole("group", { name: /^(Workers|Executoras)$/ });
        await workers.waitFor();
        // The worker rows sit under the form's sticky buttons: the print starts at them.
        await workers.evaluate((el) => el.scrollIntoView({ block: "start" }));
      },
    },
    {
      // #1222: the demo's active team at work, with its members' last reports.
      name: "times-rodando",
      route: { name: "teams", host: ALFA },
      async prepare(page) {
        const team = page.getByRole("listitem", { name: /^(Team|Time) checkout-crew$/ });
        await team.getByText(DEMO_TEAM_REPORT).scrollIntoViewIfNeeded();
      },
    },
    {
      // #4025: the running team's footer (Pause, Add worker, Close and the message field), which the
      // print above scrolls past.
      name: "times-rodape",
      route: { name: "teams", host: ALFA },
      async prepare(page) {
        const team = page.getByRole("listitem", { name: /^(Team|Time) checkout-crew$/ });
        await team.locator("[data-slot='team-footer']").scrollIntoViewIfNeeded();
      },
    },
    {
      // #4025: the same footer with Add worker open, so its form shows.
      name: "times-adicionar",
      route: { name: "teams", host: ALFA },
      async prepare(page) {
        const team = page.getByRole("listitem", { name: /^(Team|Time) checkout-crew$/ });
        // The button's name is its aria-label ("Add worker to <team>"), so the footer's own marker finds it.
        await team.locator("[data-action='add']").click();
        await team.locator("[data-slot='team-footer']").scrollIntoViewIfNeeded();
      },
    },
    {
      // #4025: a team the person paused: the Paused badge and Resume in the footer.
      name: "times-pausado",
      route: { name: "teams", host: ALFA },
      async prepare(page) {
        const team = page.getByRole("listitem", { name: /^(Team|Time) paused-crew$/ });
        await team.locator("[data-slot='team-footer']").scrollIntoViewIfNeeded();
      },
    },
    {
      // #4025: a team the plan quota paused: the badge and the "paused by the quota" line.
      name: "times-cota",
      route: { name: "teams", host: ALFA },
      async prepare(page) {
        const team = page.getByRole("listitem", { name: /^(Team|Time) quota-crew$/ });
        await team.locator("[data-slot='team-footer']").scrollIntoViewIfNeeded();
      },
    },
    {
      // #1271: New action, the longest Form dialog; narrow, its buttons rest on the sheet's bottom.
      name: "acoes-nova",
      route: {
        name: "actions",
        host: ALFA,
        projectId: ids.knowledgeProject,
        projectName: "design-system",
      },
      async prepare(page) {
        await page
          .getByRole("button", { name: /^(New action|Nova ação)$/ })
          .first()
          .click();
        await page.getByRole("dialog", { name: /^(New action|Nova ação)$/ }).waitFor();
      },
    },
    {
      // #1249: New card on the design-system board with the project's card template picked: the
      // picker and what the template starts the card with (workflow, persona, pin, spec).
      name: "card-novo-modelo",
      route: { name: "board", host: ALFA, projectId: ids.knowledgeProject },
      async prepare(page) {
        await page.getByRole("button", { name: /^(New card|Novo card)$/ }).click();
        const dialog = page.getByRole("dialog", { name: /^(New card|Novo card)$/ });
        await dialog
          .getByLabel(/^(From a template|A partir de um modelo)$/)
          .selectOption({ label: DEMO_CARD_TEMPLATE });
        await dialog.getByText(/^(Starts with|Começa com): /).waitFor();
      },
    },
    {
      // #1244: Merge PR on the card with an open PR asks first: the PR, its checks, how to merge.
      name: "card-merge-pr",
      route: { name: "board", host: ALFA, projectId: ids.project },
      async prepare(page) {
        await page
          .locator(`li[aria-label$="${DEMO_PR_CARD}"]`)
          .getByRole("button", { name: DEMO_PR_CARD, exact: true })
          .click();
        await page.getByRole("button", { name: /^(Merge PR|Fazer merge do PR)$/ }).click();
        await page.getByRole("alertdialog").getByText(DEMO_PR_URL, { exact: true }).waitFor();
      },
    },
    {
      // #76: the project's knowledge panel, scrolled into view on its page. The design-system
      // project has the demo's library (one document of each status), so the print shows the
      // filters, the statuses and the pickers, not the empty panel (#168, round 3).
      name: "projeto-conhecimento",
      route: { name: "project", host: ALFA, projectId: ids.knowledgeProject },
      async prepare(page) {
        const panel = page.getByRole("region", {
          name: /^(Project knowledge|Conhecimento do projeto)$/,
        });
        await panel.waitFor({ timeout: 15_000 });
        await panel.getByText(/^(Design tokens come from one file)$/).waitFor({ timeout: 15_000 });
        await panel.scrollIntoViewIfNeeded();
      },
    },
    {
      // #75: Set up Claude Code's preview on the empty project: what it would add, before anything
      // is written (the preview writes nothing, so the other prints see the same project).
      name: "claude-code-preparar",
      route: { name: "project", host: ALFA, projectId: ids.emptyProject },
      async prepare(page) {
        await page
          .getByRole("button", { name: /^(Set up Claude Code|Configurar o Claude Code)$/ })
          .click();
        await page
          .getByRole("alertdialog")
          .getByRole("button", { name: /^(Apply the setup|Aplicar a configuração)$/ })
          .waitFor({ timeout: 15_000 });
      },
    },
    {
      // #76: a card's pinned documents, scrolled into view on the card's page, with the picker of
      // the project's library (nothing pinned: pinning would change the demo for the next prints).
      name: "card-fixados",
      route: {
        name: "card",
        host: ALFA,
        projectId: ids.knowledgeProject,
        cardId: ids.contractCard,
      },
      async prepare(page) {
        const panel = page.getByRole("region", { name: /^(Pinned documents|Documentos fixados)$/ });
        await panel.waitFor({ timeout: 15_000 });
        await panel.scrollIntoViewIfNeeded();
      },
    },
    {
      // #978: Workflows' "Add from a template", its dialog open.
      name: "workflows-modelos",
      route: {
        name: "workflows",
        host: ALFA,
        projectId: ids.project,
        projectName: ids.projectName,
      },
      async prepare(page) {
        await page
          .getByRole("button", { name: /^(Add from a template|Adicionar de um modelo)$/ })
          .click();
        await page.getByRole("dialog").waitFor();
      },
    },
    {
      // #78: moving a card to Review without a PR asks first, and says what it lacks.
      name: "board-contrato",
      route: { name: "board", host: ALFA, projectId: ids.project },
      async prepare(page) {
        // The open menu hides the rest of the page, its trigger too: the trigger is found hidden.
        const actions = page.getByRole("button", {
          name: /^(Actions for|Ações de) Documentar a API pública$/,
          includeHidden: true,
        });
        await actions.click();
        const menuId = await actions.getAttribute("aria-controls", { timeout: 5000 });
        await page
          .getByRole("menuitem", { name: /^(Move to|Mover para) .*(eview|evisão)/ })
          .click();
        await page.getByRole("alertdialog").or(page.getByRole("dialog")).first().waitFor();
        // #1005: when the confirm shows, the card's actions menu is still on its way out (closed,
        // its exit animation running, gone some 50 ms later). The print turns animations off,
        // which drew that closing menu whole under the confirm: the print waits until it is gone.
        // A menu that stays only shows in the print; it does not end the job.
        if (menuId) {
          await page
            .locator(`[id="${menuId}"]`)
            .waitFor({ state: "detached", timeout: 5000 })
            .catch(() => undefined);
        }
      },
    },
    {
      // #961: the session's permission mode chip, its menu open.
      name: "sessao-modo",
      route: { name: "session", host: ALFA, id: ids.idleSession },
      async prepare(page) {
        await page.getByRole("button", { name: /^(Permission mode|Modo de permissão): / }).click();
        await page.getByRole("menu").waitFor();
      },
    },
    // #994: on a session page a toast sits above the message box, never on Send or the mode chip.
    {
      name: "sessao-aviso",
      route: { name: "session", host: ALFA, id: ids.idleSession },
      prepare: showToast,
    },
    {
      name: "erro",
      route: { name: "reader", target: { hostId: ALFA, claudeSessionId: "nao-existe" } },
    },
  ];
}
