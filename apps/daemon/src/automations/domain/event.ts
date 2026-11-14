import type { Issue } from "@flightdeck/protocol";

export type AutomationEvent =
  | {
      type: "pr_comment";
      cardId: string;
      commentId: string;
      author: string;
      text: string;
      /** Third party: not you, and not an owner, member or collaborator. */
      external: boolean;
    }
  | { type: "ci_failed"; cardId: string; key: string; summary: string }
  | { type: "issue_label"; projectId: string; issue: Issue }
  | { type: "cron"; projectId: string; automationId: string; minute: number };

/** What happened, for the run's history. */
export function causeOf(event: AutomationEvent): string {
  switch (event.type) {
    case "cron":
      return `schedule of ${new Date(event.minute).toISOString()}`;
    case "pr_comment":
      return `comment ${event.commentId} by ${event.author} on the PR of card ${event.cardId}`;
    case "ci_failed":
      return `checks of the PR of card ${event.cardId} failed`;
    case "issue_label":
      return `issue ${event.issue.ref} with the label ${event.issue.labels.join(", ")}`;
  }
}

/** One event fires an automation once: the same comment, issue or slot never repeats. */
export function keyOf(event: AutomationEvent): string {
  switch (event.type) {
    case "cron":
      return `cron:${event.minute}`;
    case "pr_comment":
      return `comment:${event.commentId}`;
    case "ci_failed":
      return `ci:${event.key}`;
    case "issue_label":
      return `issue:${event.issue.ref}`;
  }
}

export const isExternal = (event: AutomationEvent) =>
  (event.type === "pr_comment" && event.external) ||
  (event.type === "issue_label" && event.issue.external);

/** What the agent is told about the event; empty for a time-based one. */
export function contentOf(event: AutomationEvent): string {
  if (event.type === "pr_comment") return `Comment by ${event.author} on the PR:\n${event.text}`;
  if (event.type === "ci_failed") return `The PR's checks failed: ${event.summary}`;
  return "";
}
