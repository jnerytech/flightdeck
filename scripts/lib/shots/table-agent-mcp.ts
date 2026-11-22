/** Part of the print table (scripts/demo-shots.ts), in print order: the MCP tab of the Agent screen (#4269). */

import type { McpServerView } from "@flightdeck/protocol";
import type { Page } from "playwright-core";
import type { DemoIds } from "../../demo-seed.ts";
import { agentRoute, type Shot, toastSettled } from "./shot.ts";
import type { WireRule } from "./wire.ts";

const ECO = { command: "node", args: ["eco-server.js"], env: { ECO_MODE: "demo" } };
const MASKED = "••••••";

/** A server as the host lists it: the project's, on, with its secrets masked. */
const server = (name: string, over: Partial<McpServerView> = {}): McpServerView => ({
  name,
  transport: "stdio",
  origin: "project",
  readOnly: false,
  enabled: true,
  ...over,
});

/** What the host answers `mcp.list` with. */
const listing = (...servers: unknown[]): WireRule => ({
  command: "mcp.list",
  data: { servers },
});

/** The seeded pair, with the http server's header masked the way the host sends it. */
const SEEDED = listing(
  server("eco", ECO),
  server("github", {
    transport: "http",
    type: "http",
    url: "https://mcp.example.com/github",
    headers: { Authorization: MASKED },
  }),
);

/** A server the test would start: its command (the dialog) and what it lists (the result). The host starts nothing for a print. */
const TEST_ANSWER: WireRule = {
  command: "mcp.test",
  reply: {
    preview: { command: ECO.command, args: ECO.args },
    tools: ["echo", "ping", "read_file"],
    resources: ["demo://readme"],
  },
};

/** A user's server of a long command and a long name: its row must wrap inside the window. */
const LONG = server("a-server-whose-name-is-long-enough-to-need-a-break-inside-the-row", {
  origin: "user-project",
  readOnly: true,
  command:
    "/usr/local/lib/node_modules/@demo/mcp-server-with-a-very-long-package-name/node_modules/@demo/another-nested-package/bin/serve.js",
  args: ["--workspace", "/home/demo/projects/flightdeck-web", "--log-level", "debug", "--stdio"],
});

/** A save or a removal the print opens a form or a dialog for is answered with a refusal in the page: nothing reaches the host. */
const NO_SAVE: WireRule = { command: "mcp.save", reject: "A print does not save." };
const NO_REMOVE: WireRule = { command: "mcp.remove", reject: "A print does not remove." };

const button = (page: Page, name: RegExp) => page.getByRole("button", { name });

/** The list is drawn: the print waits for the first row. */
const listed = (page: Page) =>
  page.getByRole("list", { name: /^(MCP servers|Servidores MCP)$/ }).waitFor({ timeout: 15_000 });

const openAdd = async (page: Page) => {
  await listed(page);
  await button(page, /^(Add server|Adicionar servidor)$/).click();
  await page.getByRole("dialog").waitFor({ timeout: 15_000 });
};

const testDialog = async (page: Page) => {
  await listed(page);
  await button(page, /^(Test eco|Testar eco)$/).click();
  await page.getByRole("alertdialog").waitFor({ timeout: 15_000 });
};

export function mcpShots(ids: DemoIds): Shot[] {
  const route = agentRoute(ids);
  return [
    {
      name: "agente-mcp-vazio",
      route,
      wire: [listing()],
      prepare: async (page) => {
        await page
          .getByText(/^(No MCP servers in this project\.|Nenhum servidor MCP neste projeto\.)$/)
          .waitFor({ timeout: 15_000 });
      },
    },
    {
      name: "agente-mcp-falhou",
      route,
      wire: [{ command: "mcp.list", refuse: "The MCP servers could not be read." }],
      prepare: async (page) => {
        await button(page, /^(Try again|Tentar de novo)$/).waitFor({ timeout: 15_000 });
        await toastSettled(page);
      },
    },
    {
      name: "agente-mcp-carregando",
      route,
      wire: [{ command: "mcp.list", hold: true }],
      prepare: async (page) => {
        await page
          .getByRole("status", {
            name: /^(Loading the configuration…|Carregando a configuração…)$/,
          })
          .waitFor({ timeout: 15_000 });
        // The placeholders come 200 ms after the label: wait for them so the print shows them.
        await page.locator('[role="status"][aria-busy="true"] > *').first().waitFor();
      },
    },
    { name: "agente-mcp-novo", route, wire: [SEEDED, NO_SAVE], prepare: openAdd },
    {
      name: "agente-mcp-novo-url",
      route,
      wire: [SEEDED, NO_SAVE],
      prepare: async (page) => {
        await openAdd(page);
        await page.getByLabel(/^(Transport|Transporte)$/).selectOption("http");
        await page.getByLabel(/^URL$/).waitFor({ timeout: 15_000 });
      },
    },
    {
      name: "agente-mcp-segredo",
      route,
      wire: [SEEDED, NO_SAVE],
      prepare: async (page) => {
        await listed(page);
        await button(page, /^(Edit github|Editar github)$/).click();
        await page
          .getByText(/^(Secret values are masked|Os valores secretos aparecem mascarados)/)
          .waitFor({ timeout: 15_000 });
      },
    },
    { name: "agente-mcp-testar", route, wire: [SEEDED, TEST_ANSWER], prepare: testDialog },
    {
      name: "agente-mcp-teste-resultado",
      route,
      wire: [SEEDED, TEST_ANSWER],
      prepare: async (page) => {
        await testDialog(page);
        await button(page, /^(Run and test|Executar e testar)$/).click();
        await page.getByText("read_file").waitFor({ timeout: 15_000 });
      },
    },
    {
      name: "agente-mcp-remover",
      route,
      wire: [SEEDED, NO_REMOVE],
      prepare: async (page) => {
        await listed(page);
        await button(page, /^(Remove eco|Remover eco)$/).click();
        await page.getByRole("alertdialog").waitFor({ timeout: 15_000 });
      },
    },
    {
      name: "agente-mcp-linha-longa",
      route,
      wire: [listing(LONG)],
      prepare: async (page) => {
        await listed(page);
      },
    },
  ];
}
