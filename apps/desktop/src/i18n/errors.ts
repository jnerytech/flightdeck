import type { RuleIssue } from "@flightdeck/protocol";
import type { Key, T } from "./index.ts";
import { ptBR } from "./pt-BR.ts";

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
  if (reason && reason in ptBR.daemonRefusal) {
    return { title: t(`daemonRefusal.${reason}` as Key, paramsOf(why, t)), detail: "" };
  }
  if (reason && reason in ptBR.snippetRefusal) {
    return { title: t(`snippetRefusal.${reason}` as Key, why?.params), detail: "" };
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
  const feature = why.params?.feature;
  if (why.reason !== "feature_off" || typeof feature !== "string") return why.params;
  const named = feature in ptBR.daemonFeature ? t(`daemonFeature.${feature}` as Key) : feature;
  return { ...why.params, feature: named };
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
