/** Part of the print table (scripts/demo-shots.ts), in print order: the permission screens (#4163). */
import type { Page } from "playwright-core";
import type { DemoIds } from "../../demo-seed.ts";
import { DANGER_SESSION } from "../e2e/journeys.ts";
import { ALFA, type Shot } from "./shot.ts";
import type { WireRule } from "./wire.ts";

const WAIT = 15_000;
const button = (page: Page, name: string) =>
  page.getByRole("button", { name: new RegExp(`^(${name})$`) });
const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);

/** The rules the project's "Always in this project" buttons would have saved. */
const FIRST_RULE = "Bash(bun run test:*)";
const RULES = [FIRST_RULE, "Edit(src/cart.ts)", "Read(docs/SPEC.md)"];

/** The host's list of automatic decisions: each kind (a rule allows, the AI allows, the AI asks) and a suspended session. */
function decisions(ids: DemoIds): WireRule {
  const decision = (
    n: number,
    toolName: string,
    risk: string,
    kind: "allow" | "ask",
    by: "rule" | "ai",
    reason: string,
  ) => ({
    id: `print-${n}`,
    projectId: ids.project,
    sessionKey: ids.waitingSession,
    requestId: `print-request-${n}`,
    toolName,
    risk,
    decision: kind,
    reason,
    by,
    model: by === "ai" ? "claude-haiku-5-5" : null,
    at: `2026-11-20T10:${10 + n}:00.000Z`,
  });
  return {
    command: "autoapprove.list",
    data: {
      decisions: [
        decision(1, "Bash", "medium", "allow", "rule", "Matches Bash(bun run test:*)"),
        decision(2, "Edit", "low", "allow", "ai", "Edits a file inside the project"),
        decision(3, "Bash", "high", "ask", "ai", "Deletes files outside the project"),
      ],
      suspended: [
        {
          sessionKey: ids.waitingSession,
          reason: "Three asks in a row",
          at: "2026-11-20T10:30:00.000Z",
        },
      ],
    },
  };
}

/** Opens the project's editor, where its Rules section is, and waits for the section. */
async function openRules(page: Page, ids: DemoIds): Promise<void> {
  await button(page, `Edit ${ids.projectName}|Editar ${ids.projectName}`).click({ timeout: WAIT });
  await page.getByRole("region", { name: /^(Rules|Regras)$/ }).waitFor({ timeout: WAIT });
}

export function permissionShots(ids: DemoIds): Shot[] {
  const approvals = { name: "auto-approvals" as const, host: ALFA };
  const list = decisions(ids);
  return [
    {
      // "Always in this project" opens its rule field, with the suggested rule inside.
      name: "sessao-aprovacao-sempre",
      route: { name: "session", host: ALFA, id: ids.waitingSession },
      prepare: async (page) => {
        await button(page, "Always in this project|Sempre neste projeto").click({ timeout: WAIT });
        await page.getByRole("textbox", { name: /^(Rule|Regra)$/ }).waitFor({ timeout: WAIT });
      },
    },
    {
      // Deny asks for its optional reason before it sends.
      name: "sessao-aprovacao-negar",
      route: { name: "session", host: ALFA, id: ids.waitingSession },
      prepare: async (page) => {
        await button(page, "Deny|Negar").click({ timeout: WAIT });
        await page
          .getByRole("textbox", { name: /^(Reason \(optional\)|Motivo \(opcional\))$/ })
          .waitFor({ timeout: WAIT });
      },
    },
    {
      // A high-risk request is approved by holding the button, with the hint beside it.
      name: "sessao-aprovacao-risco-alto",
      route: { name: "needs-you" },
      prepare: async (page) => {
        await page
          .getByRole("button", { name: new RegExp(`${DANGER_SESSION}: Bash`) })
          .click({ timeout: WAIT });
        await button(page, "Hold to approve|Segurar para aprovar").waitFor({ timeout: WAIT });
      },
    },
    {
      // A project that has no rule yet: the empty text says where one comes from.
      name: "projeto-regras-vazio",
      route: { name: "projects", host: ALFA },
      prepare: async (page) => {
        await openRules(page, ids);
        await page.getByText(/^(No rules yet|Nenhuma regra ainda)/).waitFor({ timeout: WAIT });
      },
    },
    {
      name: "projeto-regras",
      route: { name: "projects", host: ALFA },
      wire: [{ command: "rules.list", data: { rules: RULES } }],
      prepare: async (page) => {
        await openRules(page, ids);
        await button(page, `Remove ${literal(FIRST_RULE)}|Remover ${literal(FIRST_RULE)}`).waitFor({
          timeout: WAIT,
        });
      },
    },
    {
      name: "projeto-regras-falhou",
      route: { name: "projects", host: ALFA },
      wire: [{ command: "rules.list", refuse: "The project's settings could not be read." }],
      prepare: async (page) => {
        await openRules(page, ids);
        await button(page, "Try again|Tentar de novo").waitFor({ timeout: WAIT });
      },
    },
    {
      // No project has turned automatic approval on in the demo: the page says when decisions appear.
      name: "aprovacoes-automaticas-vazio",
      route: approvals,
      prepare: async (page) => {
        await page
          .getByText(/^(No automatic decisions yet|Nenhuma decisão automática ainda)$/)
          .waitFor({ timeout: WAIT });
      },
    },
    {
      // Decisions of each kind, and the suspended session with its Resume button.
      name: "aprovacoes-automaticas",
      route: approvals,
      wire: [list],
      prepare: async (page) => {
        await button(page, "Resume .*|Reativar .*").waitFor({ timeout: WAIT });
        await page.getByText("Deletes files outside the project").waitFor({ timeout: WAIT });
      },
    },
    {
      // A filter that matches nothing says so, and the suspended sessions stay.
      name: "aprovacoes-automaticas-sem-resultado",
      route: approvals,
      wire: [list],
      prepare: async (page) => {
        await page.getByText("Deletes files outside the project").waitFor({ timeout: WAIT });
        await page
          .getByRole("textbox", { name: /^(Filter decisions|Filtrar decisões)$/ })
          .fill("zzz");
        await page
          .getByText(/^(No decision matches the filter|Nenhuma decisão corresponde ao filtro)$/)
          .waitFor({ timeout: WAIT });
      },
    },
    {
      name: "aprovacoes-automaticas-falhou",
      route: approvals,
      wire: [{ command: "autoapprove.list", refuse: "The decision log could not be read." }],
      prepare: async (page) => {
        await button(page, "Try again|Tentar de novo").waitFor({ timeout: WAIT });
      },
    },
  ];
}
