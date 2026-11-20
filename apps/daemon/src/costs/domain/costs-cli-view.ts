/** Issue #3460: what `flightdeckd costs` takes and says, as pure rules over the daemon's answers. */
import type { CostsSession, CostsStatus, CostsSummary, UsageOrigin } from "@flightdeck/protocol";

export interface CostsCliArgs {
  action: "summary" | "session" | "card" | "run" | "status" | "export";
  /** `session`: the Claude session id; `card`: the card id; `run`: the run id. */
  id?: string;
  /** `summary` and `export`: the first and last day (`YYYY-MM-DD`), and the filters. */
  from?: string;
  to?: string;
  projectKey?: string;
  model?: string;
  origin?: UsageOrigin;
  json?: boolean;
}

export const usd = (amount: number) => `$${amount.toFixed(2)}`;

/** The totals, then one line per project, model, origin, persona and top session. */
export function summaryLines(summary: CostsSummary): string[] {
  const { totals } = summary;
  const { input, output, cacheRead, cacheWrite5m, cacheWrite1h } = totals.tokens;
  const unpriced =
    totals.unpricedMessages > 0 ? ` (${totals.unpricedMessages} without a price)` : "";
  return [
    `${summary.from} to ${summary.to}: ${usd(totals.costUsd)}, ${totals.messages} messages${unpriced}`,
    `tokens: ${input} in, ${output} out, ${cacheRead} cache read, ${cacheWrite5m + cacheWrite1h} cache write`,
    `cache saved ${usd(totals.cacheSavingsUsd)}`,
    ...summary.byProject.map((p) => `project  ${p.projectKey}  ${usd(p.costUsd)}`),
    ...summary.byModel.map((m) =>
      m.priced
        ? `model  ${m.model}  ${usd(m.costUsd)}`
        : `model  ${m.model}  no price, ${m.tokens} tokens`,
    ),
    ...summary.byOrigin.map((o) => `origin  ${o.origin}  ${usd(o.costUsd)}`),
    ...summary.byPersona.map((p) => `persona  ${p.persona ?? "none"}  ${usd(p.costUsd)}`),
    ...summary.topSessions.map(
      (s) => `session  ${s.claudeSessionId}  ${s.title ?? s.projectKey}  ${usd(s.costUsd)}`,
    ),
  ];
}

/** The session's cost, the part its subagents spent and each model. */
export function sessionLines(session: CostsSession): string[] {
  return [
    `${session.claudeSessionId}: ${usd(session.costUsd)}, ${session.tokens} tokens, ${usd(session.subagentCostUsd)} of it by subagents`,
    ...session.byModel.map((m) => `model  ${m.model}  ${usd(m.costUsd)}  ${m.tokens} tokens`),
  ];
}

/** How far the transcripts are read, the price date, the models without a price and the sessions that differ. */
export function statusLines(status: CostsStatus): string[] {
  const { initialLoad } = status;
  const flags = [
    ...status.unpriced.map(
      (u) => `no price: ${u.model} (${u.entries} messages, ${u.tokens} tokens)`,
    ),
    ...status.divergences.map(
      (d) =>
        `differs from the SDK: ${d.claudeSessionId}  ${d.model}  computed ${usd(d.computedUsd)}, SDK ${usd(d.sdkUsd)}`,
    ),
  ];
  return [
    `transcripts: ${initialLoad.state}, ${initialLoad.filesDone} of ${initialLoad.filesTotal} files`,
    `prices from ${status.pricingDate}`,
    ...(flags.length === 0
      ? ["every model has a price, and no session differs from the SDK"]
      : flags),
  ];
}

/** The csv's lines, without the empty one a closing newline leaves. */
export const csvLines = (csv: string): string[] => csv.replace(/\r?\n$/, "").split(/\r?\n/);
