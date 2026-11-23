/**
 * Part of the print table (scripts/demo-shots.ts): the states of the Clients screen the four
 * first prints left out (#4345). Each print starts from the clients its `clients.data` keeps in the
 * page's storage, so no print types a client in: a "Client created" line would not be on a print
 * that is about something else. The empty state has no `clients` at all, which clears the storage.
 */
import type { Locator, Page } from "playwright-core";
import { DEMO_CLIENTS, type Shot } from "./shot.ts";

const route = { name: "clients" } as const;

const rule = { id: "r1", kind: "remote", pattern: "github.com/acme/*" } as const;

const stored = (clients: object[], budgets: Record<string, number> = {}): string =>
  JSON.stringify({ v: 1, clients, overrides: {}, budgets });

const client = (id: string, name: string, rules: object[], vaultTag?: string): object => ({
  id,
  name,
  color: "indigo",
  rules,
  defaults: { vaultScope: false, ...(vaultTag ? { vaultTag } : {}) },
});

/** Acme with no rule: the demo's Acme remote is unclaimed, so the suggestion is to add the rule to it. */
const UNCLAIMED = stored([client("acme", "Acme", [])]);

/** Acme with the vault tag the demo's secrets carry, and no scope yet. */
const TAGGED = stored([client("acme", "Acme", [rule], "ci")], { acme: 500 });

/** One client with a name and two rules that are longer than a narrow window: they must wrap. */
const LONG = stored(
  [
    client("industrial", "Acme Industrial Holdings International, Brazil Operations Division", [
      {
        id: "r1",
        kind: "folder",
        path: "/home/ubuntu/work/clients/acme-industrial/services/payments-gateway/packages/ledger-reconciliation-worker",
      },
      {
        id: "r2",
        kind: "remote",
        pattern: "github.com/acme-industrial-holdings/payments-gateway-ledger-reconciliation/*",
      },
    ]),
  ],
  { industrial: 500 },
);

const NAME = (verb: RegExp) => new RegExp(`^(${verb.source}) Acme$`);
const RENAME = NAME(/Rename|Renomear/);
const REMOVE = NAME(/Delete|Excluir/);
const SUGGEST = /^(Suggest from what I have|Sugerir a partir do que tenho)$/;
const EXPORT = /^(Export clients|Exportar clientes)$/;
const EXPORT_BOX = /^(Clients export|Exportação dos clientes)$/;
const PASTE = /^(Paste an export|Colar uma exportação)$/;
const IMPORT = /^(Import|Importar)$/;
const SWITCH = /^(Keep the secrets with this tag|Manter os segredos com essa tag)/;
const FINDINGS = /^(Secrets that could leave the client|Segredos que podem sair do cliente)$/;

/** Brings an element into the window: the screen is long, and a print shows only its top. */
const show = (target: Locator) => target.scrollIntoViewIfNeeded();

async function suggest(page: Page): Promise<void> {
  await page.getByRole("button", { name: SUGGEST }).click();
}

/** Types an import into its box and presses Import. */
async function paste(page: Page, text: string): Promise<void> {
  await page.getByLabel(PASTE).fill(text);
  await page.getByRole("button", { name: IMPORT }).click();
}

export function clientsShots(): Shot[] {
  return [
    // No client yet: the empty state, with the create field and the suggestion under it.
    {
      name: "clientes-vazio",
      route,
      prepare: async (page) => {
        await page.getByText(/^(No clients yet|Nenhum cliente ainda)$/).waitFor();
      },
    },
    {
      // Rename mode: the form takes the client's name, with Save name and Cancel.
      name: "clientes-renomear",
      route,
      clients: {},
      prepare: async (page) => {
        await page.getByRole("button", { name: RENAME }).click();
        const save = page.getByRole("button", { name: /^(Save name|Salvar nome)$/ });
        await save.waitFor();
        await show(save);
      },
    },
    {
      // Delete asks first, and says nothing is deleted from the hosts.
      name: "clientes-apagar",
      route,
      clients: {},
      prepare: async (page) => {
        await page.getByRole("button", { name: REMOVE }).click();
        await page.getByRole("alertdialog").waitFor();
      },
    },
    {
      // A suggestion for the project no rule claims: the button adds the rule to the client.
      name: "clientes-sugestoes",
      route,
      clients: { data: UNCLAIMED },
      prepare: async (page) => {
        await suggest(page);
        const list = page.getByRole("list", {
          name: /^(Client suggestions|Sugestões de clientes)$/,
        });
        await list.waitFor({ timeout: 15_000 });
        await show(list);
      },
    },
    {
      // Every known project has a client: the line says so.
      name: "clientes-sugestoes-nada",
      route,
      clients: {},
      prepare: async (page) => {
        await suggest(page);
        const nothing = page.getByText(/^(Nothing to suggest|Nada a sugerir)/);
        await nothing.waitFor();
        await show(nothing);
      },
    },
    {
      // The export, as text to copy to the other computer.
      name: "clientes-exportado",
      route,
      clients: {},
      prepare: async (page) => {
        await page.getByRole("button", { name: EXPORT }).click();
        const box = page.getByLabel(EXPORT_BOX);
        await box.waitFor();
        await show(box);
      },
    },
    {
      // Text that is not an export: an alert, and nothing imported.
      name: "clientes-importar-erro",
      route,
      clients: {},
      prepare: async (page) => {
        await paste(page, "this is not an export");
        const alert = page.getByRole("alert").filter({
          hasText: /^(That is not a clients export|Isso não é uma exportação de clientes)/,
        });
        await alert.waitFor();
        await show(alert);
      },
    },
    {
      // The demo's own export pasted back: nothing is new, both clients are updated.
      name: "clientes-importar-ok",
      route,
      clients: {},
      prepare: async (page) => {
        await paste(page, DEMO_CLIENTS);
        const done = page.getByText(/^(Imported|Importado):/);
        await done.waitFor();
        await show(done);
      },
    },
    {
      // Turning the vault scope on asks first, and says how many rules the secrets get.
      name: "clientes-cofre-confirmar",
      route,
      clients: { data: TAGGED },
      secrets: "wide",
      prepare: async (page) => {
        await page.getByRole("switch", { name: SWITCH }).click();
        await page.getByRole("alertdialog").waitFor({ timeout: 15_000 });
      },
    },
    {
      // The secrets of the tag that could leave the client: one is allowed on a host with none of its projects.
      name: "clientes-cofre-achados",
      route,
      clients: { data: TAGGED },
      secrets: "wide",
      prepare: async (page) => {
        const findings = page.getByText(FINDINGS);
        await findings.waitFor({ timeout: 15_000 });
        await show(findings);
      },
    },
    {
      // A client whose name and rules are longer than a narrow window, with its budget line.
      name: "clientes-longo",
      route,
      clients: { data: LONG },
      prepare: async (page) => {
        await page.locator("[data-client-name]").first().waitFor();
        await show(page.locator("[data-rule-value]").first());
      },
    },
  ];
}
