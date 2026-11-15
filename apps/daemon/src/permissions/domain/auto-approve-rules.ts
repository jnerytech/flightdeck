import { join } from "node:path";
import { summarizeInput } from "./bind-input.ts";
import type { Risk } from "./risk.ts";

/** The folder the AI's queries run in: excluded from the history, so they never show up. */
export function autoApproveDir(dataDir: string): string {
  return join(dataDir, "auto-approve");
}

const POLICY =
  "Aprove só se for claramente seguro e dentro do pedido; na dúvida, ask. " +
  'Responda com decision ("allow" ou "ask") e reason.';

/**
 * The never-automatic rules, in order: a suspended session, high risk, the network, and low risk
 * when the project lets it pass without AI. Null when none applies, so the AI is asked.
 */
export function ruleDecision(input: {
  risk: Risk;
  suspended: { reason: string } | null;
  lowWithoutAi: boolean;
}): { decision: "allow" | "ask"; reason: string; by: "rule"; model: null } | null {
  const rule = (decision: "allow" | "ask", reason: string) => ({
    decision,
    reason,
    by: "rule" as const,
    model: null,
  });
  if (input.suspended) {
    return rule("ask", `aprovação automática suspensa: ${input.suspended.reason}`);
  }
  if (input.risk.level === "high") return rule("ask", "risco alto nunca é automático");
  if (input.risk.network) return rule("ask", "acesso à rede nunca é automático");
  if (input.risk.level === "low" && input.lowWithoutAi) return rule("allow", "risco baixo, sem IA");
  return null;
}

/** What the AI is asked about a request: the tool, its input, the cwd, the risk and the card's ask. */
export function autoApprovePrompt(
  request: { toolName: string; input: Record<string, unknown>; cwd: string; risk: Risk },
  description: string | undefined,
): string {
  return [
    "Um agente de código pede permissão para usar uma ferramenta.",
    `ferramenta: ${request.toolName}`,
    `entrada: ${JSON.stringify(summarizeInput(request.input))}`,
    `cwd: ${request.cwd}`,
    `risco: ${request.risk.level} (${request.risk.reason})`,
    ...(description ? [`pedido do card: ${description.slice(0, 1000)}`] : []),
    POLICY,
  ].join("\n");
}
