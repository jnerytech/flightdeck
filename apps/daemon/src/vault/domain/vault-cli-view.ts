/**
 * Issue #3458: what `flightdeckd vault decisions|report|rules` say, as pure rules over the daemon's
 * answers. The daemon calls and the exit codes stay in `vault/vault-cli.ts`.
 */
import type {
  VaultDecisionInfo,
  VaultReportRow,
  VaultRequester,
  VaultRequestFrame,
  VaultUsed,
  VaultVerdict,
} from "@flightdeck/protocol";

/** What the person typed for `vault <verb>`, as `runVaultCli` takes it: what they left out stays out, and a `preview` always names who asks and what for. `--json` prints the daemon's own answer, for a script. */
interface Printed {
  json?: boolean;
}
export type VaultCliArgs =
  | (Printed & { action: "decisions"; secretId?: string; days?: number; limit?: number })
  | (Printed & { action: "report"; days?: number; csv?: boolean })
  | (Printed & { action: "rules"; secretId: string })
  | (Printed & { action: "watch" })
  | (Printed & { action: "deny"; requestId: string })
  | (Printed & {
      action: "preview";
      secretId: string;
      requester: VaultRequester;
      purpose: "ssh" | "action" | "run_with_secret";
      /** The action's name (`--action`). */
      useAction?: string;
      host?: string;
      project?: string;
      session?: string;
      tags?: string[];
      risk?: "low" | "medium" | "high";
      approval?: "always" | "never" | "first-per-session";
      /** When the use would happen, in milliseconds since the epoch. */
      at?: number;
    });

/** One decision of `vault decisions`: when, which secret, who for what and where, how it went, and why. */
export function decisionLine(d: VaultDecisionInfo): string {
  const action = d.action ? ` ${d.action}` : "";
  const use = `${d.purpose}${action} on ${d.host}`;
  const by = d.approver ? ` (${d.approver})` : "";
  return `${d.at}  ${d.secretId}  ${d.requester}  ${use}  ${d.decision}/${d.outcome}${by}  ${d.reason}`;
}

/** One row of `vault report`: uses by secret, requester and outcome. */
export function reportLine(row: VaultReportRow): string {
  return `${row.secretId}  ${row.requester}  ${row.outcome}  ${row.count}`;
}

/** The lines of `vault rules <secret>`: its tags, then one line per rule as the daemon holds it. */
export function ruleLines(answer: { tags: string[]; rules: unknown[] }): string[] {
  const tags = `tags: ${answer.tags.length ? answer.tags.join(", ") : "(none)"}`;
  if (!answer.rules.length) return [tags, "no rules"];
  return [tags, ...answer.rules.map((rule, i) => `rule ${i + 1}: ${JSON.stringify(rule)}`)];
}

/** The line of `vault rules preview`: what a use would get, and which rule or default said so. */
export function verdictLine(v: VaultVerdict): string {
  const by = v.ruleId ? `by rule ${v.ruleId}` : "by default";
  const notes = [
    v.once ? " [once per session]" : "",
    v.needsHold ? " [approval must be held 2 s]" : "",
    v.limited ? " [limit reached]" : "",
  ].join("");
  return `${v.decision} ${by}: ${v.reason}${notes}`;
}

/** The line `vault watch` prints for a use that asks, or is let through by a rule, and waits for the app. */
export function requestLine(frame: VaultRequestFrame): string {
  const action = frame.action ? ` ${frame.action}` : "";
  const where = frame.host ? ` on ${frame.host}` : "";
  const parts = [
    `request ${frame.requestId}`,
    frame.secretId,
    frame.requester,
    `${frame.purpose}${action}${where}`,
  ];
  if (frame.decision) parts.push(requestVerdict(frame));
  if (frame.command) parts.push(`runs: ${frame.command}`);
  return parts.join("  ");
}

/** What the rules decided for a request, and why, with the notes the app shows beside it. */
function requestVerdict(frame: VaultRequestFrame): string {
  const by = frame.ruleId ? ` by rule ${frame.ruleId}` : "";
  const why = frame.reason ? `: ${frame.reason}` : "";
  const notes = [
    frame.needsHold ? "[approval must be held 2 s]" : "",
    frame.once ? "[once per session]" : "",
  ].filter(Boolean);
  return [`${frame.decision}${by}${why}`, ...(notes.length ? [notes.join(" ")] : [])].join("  ");
}

/** The line `vault watch` prints for a delivered secret that was used. It never holds the value. */
export function usedLine(frame: VaultUsed): string {
  const use = frame.action ? `${frame.purpose} ${frame.action}` : frame.purpose;
  return `used  ${frame.secretId}  ${frame.requester}  ${use}  ${frame.at}`;
}
