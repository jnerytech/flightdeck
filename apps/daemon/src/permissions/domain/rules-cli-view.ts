/**
 * Issue #3457: the permission rules of a project and the automatic approver's decisions as
 * `flightdeckd rules` and `flightdeckd autoapprove` show them. The rules are printed as the project's
 * file holds them, so a person can name one to remove it; a reason the approver wrote is cut of its
 * secrets, as the open requests are (#3425).
 */
import {
  type AutoApprovalRecord,
  type AutoApproveSuspension,
  SecretScanner,
} from "@flightdeck/protocol";

const scanner = new SecretScanner();

export interface AutoApproveAnswer {
  decisions: AutoApprovalRecord[];
  suspended: AutoApproveSuspension[];
}

export interface RulesCliArgs {
  /** The noun after `flightdeckd`. */
  noun: "rules" | "autoapprove";
  action: "list" | "remove" | "resume";
  /** `--project`: the name or id; `rules list` needs one unless the host has a single project. */
  project?: string;
  /** `rules remove <rule>`: the rule, exactly as `rules list` printed it. */
  rule?: string;
  /** `--confirm`: the yes that `rules remove` and `autoapprove resume` need. */
  confirm?: boolean;
  /** `autoapprove list --session`: the session key the decisions are about; `resume` needs it. */
  session?: string;
  /** `autoapprove list --limit`: how many decisions to read, 1 to 1000. */
  limit?: number;
  json?: boolean;
}

export function ruleLines(rules: readonly string[], projectName: string): string[] {
  return rules.length > 0 ? [...rules] : [`no permission rules in ${projectName}`];
}

/** The daemon's answer with the secrets of every reason cut out. */
export function redactedAnswer(answer: AutoApproveAnswer): AutoApproveAnswer {
  const cut = (text: string) => scanner.redact(text, false);
  return {
    decisions: answer.decisions.map((d) => ({ ...d, reason: cut(d.reason) })),
    suspended: answer.suspended.map((s) => ({ ...s, reason: cut(s.reason) })),
  };
}

/** The suspended sessions first (they need a person), then the decisions, newest first as the daemon sent them. */
export function autoApproveLines(answer: AutoApproveAnswer): string[] {
  const lines = [
    ...answer.suspended.map((s) => `suspended  ${s.sessionKey}  ${s.reason}  ${s.at}`),
    ...answer.decisions.map((d) =>
      [d.at, d.decision, d.risk, d.toolName, d.sessionKey, d.by, d.reason].join("  "),
    ),
  ];
  return lines.length > 0 ? lines : ["no automatic approval decisions yet"];
}

export const UNSURE =
  "; the change may or may not have gone in: check with `rules list` or `autoapprove list` before trying again";

export function removedLine(rule: string, projectName: string, left: number): string {
  return `removed ${rule} from ${projectName}, ${left} ${left === 1 ? "rule" : "rules"} left`;
}
