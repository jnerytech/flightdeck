/**
 * Issue #1612: how many issues a project's GitHub closed in a period, asked of the host's `gh`. This
 * is the only place the ROI signals run `gh`; the domain gets a count or the reason there is none.
 */
import { z } from "zod";
import { parseJsonOr, runCommand, whichOnPath } from "../../kernel/index.ts";

export type ClosedIssues =
  | { count: number }
  | { error: "gh_missing" | "gh_logged_out" | "gh_failed" };

/** The issues closed from `from` to `to` (dates, `YYYY-MM-DD`) in the repository at `cwd`, at most 100. */
export async function closedIssues(cwd: string, from: string, to: string): Promise<ClosedIssues> {
  const gh = whichOnPath("gh");
  if (!gh) return { error: "gh_missing" };
  const answer = await runCommand(
    [
      gh,
      "issue",
      "list",
      "--state",
      "closed",
      "--search",
      `closed:${from}..${to}`,
      "--limit",
      "100",
      "--json",
      "number",
    ],
    cwd,
  ).catch(() => null);
  if (!answer) return { error: "gh_failed" };
  if (answer.code !== 0) {
    return { error: /gh auth login/.test(answer.stderr) ? "gh_logged_out" : "gh_failed" };
  }
  const list = parseJsonOr(z.array(z.unknown()), answer.stdout, null);
  if (list === null) return { error: "gh_failed" };
  return { count: list.length };
}
