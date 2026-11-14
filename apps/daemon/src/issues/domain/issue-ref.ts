/** The parts of a `github:owner/repo#n` or `azure:org/project#id` reference. */
export function parseIssueRef(
  ref: string,
): { provider: "github" | "azure"; scope: string; id: string } | null {
  const match = /^(github|azure):(.+)#(\d+)$/.exec(ref);
  return match
    ? {
        provider: match[1] as "github" | "azure",
        scope: match[2] as string,
        id: match[3] as string,
      }
    : null;
}

/** What a PR says so the provider links it to the issue and closes it on merge. */
export function closingLine(ref: string): string | null {
  const parsed = parseIssueRef(ref);
  if (!parsed) return null;
  return parsed.provider === "github" ? `Fixes #${parsed.id}` : `AB#${parsed.id}`;
}
