/**
 * Opening a PR, shared by a card (phase 22) and a plain session (#1133): the title and description
 * checked for secrets, the branch pushed to `origin`, the PR opened through the provider.
 */
import type { SecretScanner } from "@flightdeck/protocol";
import { FlightdeckError } from "../errors.ts";
import { whichOnPath } from "../which.ts";
import { killTree, runCommand } from "./command.ts";
import type { PrProvider } from "./pr.ts";
import { refArg } from "./ref-arg.ts";
import { must } from "./worktree.ts";

/**
 * What goes public is checked: each field refused by its own reason, naming the pattern found and
 * never the secret.
 */
export function assertNoSecretInPr(
  scanner: Pick<SecretScanner, "scan"> | undefined,
  title: string,
  body: string,
): void {
  for (const [field, text, reason] of [
    ["description", body, "pr_secret"],
    ["title", title, "pr_title_secret"],
  ] as const) {
    const found = scanner?.scan(text) ?? [];
    if (found.length > 0) {
      throw new FlightdeckError(
        "bad_request",
        `the ${field} looks like it has a secret (${found.join(", ")}): take it out before opening the PR`,
        reason,
        { found: found.join(", ") },
      );
    }
  }
}

/** How long the push may take: a credential helper or a host prompt never waits for good. */
const PUSH_TIMEOUT_MS = 120_000;
/** No prompt can wait on a terminal the daemon does not have. */
const PUSH_ENV = { GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" };

/** Pushes `branch` to `origin` with its upstream and opens the PR into `base`; returns its URL. */
export async function publishPr(opts: {
  cwd: string;
  branch: string;
  base: string;
  title: string;
  body: string;
  provider: PrProvider;
}): Promise<string> {
  const { cwd, branch, base, title, body, provider } = opts;
  // The whole ref on both sides: no `push.default`, upstream or refspec setting can send it elsewhere.
  const ref = `refs/heads/${refArg(branch)}`;
  // git-arg: the branch went through assertBranchName and refArg.
  const pushed = await runCommand(
    [whichOnPath("git") ?? "git", "push", "-u", "origin", `${ref}:${ref}`],
    cwd,
    undefined,
    PUSH_TIMEOUT_MS,
    killTree,
    PUSH_ENV,
  );
  must(pushed, "git push");
  return provider.create({ cwd, base, head: branch, title, body });
}
