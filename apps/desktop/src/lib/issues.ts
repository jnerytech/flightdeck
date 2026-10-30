import type { Issue } from "@flightdeck/protocol";

const GITHUB = /^github:([^#]+)#(\d+)$/;
const AZURE = /^azure:([^/#]+)\/([^#]+)#(\d+)$/;

/** The web address of an issue from its ref (`github:owner/repo#n`, `azure:org/project#id`). */
export function issueUrl(ref: string): string | null {
  const github = GITHUB.exec(ref);
  if (github) return `https://github.com/${github[1]}/issues/${github[2]}`;
  const azure = AZURE.exec(ref);
  if (azure) {
    const project = encodeURIComponent(azure[2] as string);
    return `https://dev.azure.com/${azure[1]}/${project}/_workitems/edit/${azure[3]}`;
  }
  return null;
}

/** `Acme/App#2`: the ref without its provider. */
export function issueLabel(ref: string): string {
  return ref.replace(/^[a-z]+:/, "");
}

/** `#2`: the number alone, for a card's tile. */
export function issueNumber(ref: string): string {
  const at = ref.lastIndexOf("#");
  return at < 0 ? ref : ref.slice(at);
}

/** The issues that match `text` in their title, ref, author or labels; all when it is blank. */
export function filterIssues(issues: Issue[], text: string): Issue[] {
  const needle = text.trim().toLowerCase();
  if (!needle) return issues;
  return issues.filter((issue) =>
    [issue.title, issue.ref, issue.author, ...issue.labels].some((field) =>
      field.toLowerCase().includes(needle),
    ),
  );
}
