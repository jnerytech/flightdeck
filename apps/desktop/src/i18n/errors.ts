import type { RuleIssue } from "@flightdeck/protocol";
import type { Key, T } from "./index.ts";
import { ptBR } from "./pt-BR.ts";
import { secretKindsText } from "./secret-kinds.ts";

/**
 * A daemon (or connection) error for the user: the translated title by `code`, with the daemon's
 * own message as the detail. An unknown code gets a generic title; the message is never the only
 * thing shown. An app-side error (no code) is its own text.
 */
export function translateError(
  code: string,
  message: string,
  t: T,
  why?: { reason?: string; params?: Record<string, string | number> },
): { title: string; detail: string } {
  // A reason the app has a text for is the whole sentence; the message is for logs.
  const reason = why?.reason;
  // A rule refused for the path it names, not for its risk (#524): it says so.
  if (reason === "perm_rule_too_broad" && why?.params?.names === "folder") {
    return { title: t("alwaysAllow.refusedFolder", { tool: String(why.params.tool) }), detail: "" };
  }
  if (reason && reason in ptBR.daemonRefusal) {
    return { title: t(`daemonRefusal.${reason}` as Key, paramsOf(why, t)), detail: "" };
  }
  if (reason && reason in ptBR.snippetRefusal) {
    return { title: t(`snippetRefusal.${reason}` as Key, kindsNamed(why, t)), detail: "" };
  }
  if (code === "") return { title: message, detail: "" };
  const known = code in ptBR.errors && code !== "unknown";
  return { title: t(`errors.${known ? code : "unknown"}` as Key), detail: message };
}

/** The params of a reason; a feature's id is named in the app's language (an unknown one stays as it is). */
function paramsOf(
  why: { reason?: string; params?: Record<string, string | number> },
  t: T,
): Record<string, string | number> | undefined {
  if (why.reason && CONTRACT_REASONS.has(why.reason)) return contractNamed(why.params, t);
  const feature = why.params?.feature;
  if (why.reason !== "feature_off" || typeof feature !== "string") return kindsNamed(why, t);
  const named = feature in ptBR.daemonFeature ? t(`daemonFeature.${feature}` as Key) : feature;
  return { ...why.params, feature: named };
}

/** The reasons about a column's contract (issue #78): they name a column and what a card lacks. */
const CONTRACT_REASONS = new Set(["card_contract_unmet", "card_moved_anyway", "contract_invalid"]);

/** The column and what the card lacks (`pr,checksFailing`), named in the app's language. */
function contractNamed(
  params: Record<string, string | number> | undefined,
  t: T,
): Record<string, string | number> {
  const column = String(params?.column ?? "");
  const named = column in ptBR.kanban.columns ? t(`kanban.columns.${column}` as Key) : column;
  const needs = String(params?.needs ?? "")
    .split(",")
    .filter(Boolean)
    .map((need) =>
      need in ptBR.board.contract.needs ? t(`board.contract.needs.${need}` as Key) : need,
    );
  return { ...params, column: named, needs: needs.join(", ") };
}

/** The param that holds the kinds of secret a refusal names: the scanner's ids, named here (#714). */
const KINDS_PARAM: Record<string, string> = {
  persona_has_secret: "kinds",
  pr_secret: "found",
  pr_title_secret: "found",
  merge_message_secret: "found",
  secret: "kinds",
};

function kindsNamed(
  why: { reason?: string; params?: Record<string, string | number> } | undefined,
  t: T,
): Record<string, string | number> | undefined {
  const key = why?.reason ? KINDS_PARAM[why.reason] : undefined;
  const kinds = key ? why?.params?.[key] : undefined;
  if (!key || typeof kinds !== "string") return why?.params;
  return { ...why?.params, [key]: secretKindsText(t, kinds) };
}

/** One line for a form or a panel: the translated text, then the daemon's message when it has one. */
export function refusalText(
  code: string,
  message: string,
  t: T,
  why?: { reason?: string; params?: Record<string, string | number> },
): string {
  const { title, detail } = translateError(code, message, t, why);
  return detail ? `${title} ${detail}` : title;
}

/** One thing wrong in a workflow file, with the step it belongs to. */
export function workflowIssueText(issue: RuleIssue, t: T): string {
  const text =
    issue.code in ptBR.workflowIssue
      ? t(`workflowIssue.${issue.code}` as Key, issue.params)
      : issue.code;
  return issue.path ? `${issue.path}: ${text}` : text;
}

/** One thing wrong in an action file or definition, with the action it belongs to. */
export function actionIssueText(issue: RuleIssue, t: T): string {
  const text =
    issue.code in ptBR.actionIssue
      ? t(`actionIssue.${issue.code}` as Key, issue.params)
      : issue.code;
  return issue.path ? `${issue.path}: ${text}` : text;
}

/** One thing wrong in a vault rule, in the app's language. */
export function ruleIssueText(issue: RuleIssue, t: T): string {
  if (!(issue.code in ptBR.ruleIssue)) return `${issue.path}: ${issue.code}`;
  const field = issue.path.split(".").at(-1) ?? "";
  return t(`ruleIssue.${issue.code}` as Key, { ...issue.params, field });
}
