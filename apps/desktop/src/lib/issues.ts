import type { Issue } from "@flightdeck/protocol";

/** The web address of an issue from its ref (`github:owner/repo#n`, `azure:org/project#id`). */
export function issueUrl(_ref: string): string | null {
  return null;
}

/** `Acme/App#2`: the ref without its provider. */
export function issueLabel(ref: string): string {
  return ref;
}

/** `#2`: the number alone, for a card's tile. */
export function issueNumber(ref: string): string {
  return ref;
}

/** The issues that match `text` in their title, ref, author or labels; all when it is blank. */
export function filterIssues(issues: Issue[], _text: string): Issue[] {
  return issues;
}
