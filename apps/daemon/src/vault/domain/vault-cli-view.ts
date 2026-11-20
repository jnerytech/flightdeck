/**
 * Issue #3458: what `flightdeckd vault decisions|report|rules` say, as pure rules over the daemon's
 * answers. The daemon calls and the exit codes stay in `vault/vault-cli.ts`.
 */
import type {
  VaultDecisionInfo,
  VaultReportRow,
  VaultRequester,
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
  const use = `${d.purpose}${d.action ? ` ${d.action}` : ""} on ${d.host}`;
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
