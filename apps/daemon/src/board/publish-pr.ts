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

/**
 * How long the push may take: a credential helper or a host prompt never waits for good, and a
 * card's first push of a large branch still fits.
 */
const PUSH_TIMEOUT_MS = 600_000;
/** How much of a failed push's output reaches the app: enough to say why. */
const OUTPUT_LIMIT = 2000;
/** No prompt can wait on a terminal the daemon does not have. */
const PUSH_ENV = { GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" };

/**
 * `text` with every address in it cut to its scheme, host and path: no user or password (up to the
 * last `@` before the path, since a password may hold one), no query and no fragment, where a
 * token may ride. Git quotes the address in its messages, and `changes.get` shows the push address.
 */
export function withoutCredentials(text: string): string {
  // A scheme starts where its run of scheme characters starts (the lookbehind), so each run is
  // read once; the digits and signs before its first letter are kept as they were.
  return text.replace(
    /(?<![a-z0-9+.-])([0-9+.-]*[a-z][a-z0-9+.-]*:\/\/)([^\s'"]*)/gi,
    (_, scheme: string, rest: string) => {
      const address = rest.replace(/^[^/]*@/, "");
      const cut = address.search(/[?#]/);
      return scheme + (cut === -1 ? address : address.slice(0, cut));
    },
  );
}

/**
 * Pushes `branch` to `origin` with its upstream and opens the PR into `base`; returns its URL.
 * With `commit`, that commit is what the branch gets on `origin`, whatever the local branch holds
 * by then.
 */
export async function publishPr(opts: {
  cwd: string;
  branch: string;
  base: string;
  title: string;
  body: string;
  provider: PrProvider;
  commit?: string;
  /** The host's scanner: a failed push's output (a hook's, a helper's) is withheld when it finds one. */
  scanner?: Pick<SecretScanner, "scan">;
  timeoutMs?: number;
}): Promise<string> {
  const { cwd, branch, base, title, body, provider, commit } = opts;
  const git = whichOnPath("git") ?? "git";
  // The whole ref on both sides: no `push.default`, upstream or refspec setting can send it elsewhere.
  const ref = `refs/heads/${refArg(branch)}`;
  // A commit pushed by its id sets no upstream: it is set once the push is in.
  const source = commit === undefined ? ["-u", `${ref}:${ref}`] : [`${refArg(commit)}:${ref}`];
  // The branch alone: no submodule and no tag goes along, whatever the checkout's settings say.
  // git-arg: the branch went through assertBranchName and refArg, the commit through refArg.
  const pushed = await runCommand(
    [git, "push", "--no-recurse-submodules", "--no-follow-tags", "origin", ...source],
    cwd,
    undefined,
    opts.timeoutMs ?? PUSH_TIMEOUT_MS,
    killTree,
    PUSH_ENV,
  );
  if (pushed.timedOut) {
    throw new FlightdeckError("invalid_state", "git push ran past its limit", "pr_push_timeout");
  }
  if (pushed.code !== 0) {
    // Git's message names the address: what reaches the app or a log carries no credential. The
    // rest is scanned whole, then cut: a hook or a credential helper may print a secret.
    const shown = withoutCredentials(pushed.stderr.trim());
    const found = opts.scanner?.scan(shown) ?? [];
    if (found.length > 0) {
      throw new FlightdeckError(
        "invalid_state",
        `git push failed, and its output looks like it has a secret (${found.join(", ")}): it is not shown`,
        "pr_push_withheld",
        { found: found.join(", ") },
      );
    }
    const output = shown.slice(0, OUTPUT_LIMIT);
    throw new FlightdeckError("invalid_state", `git push: ${output}`, "command_failed", {
      what: "git push",
      output,
    });
  }
  if (commit !== undefined) {
    // Only a convenience for a later `git push` by hand: when it fails, the PR still opens.
    // git-arg: the branch went through assertBranchName and refArg.
    await runCommand(
      [git, "branch", `--set-upstream-to=origin/${refArg(branch)}`, refArg(branch)],
      cwd,
      undefined,
      PUSH_TIMEOUT_MS,
      killTree,
      PUSH_ENV,
    );
  }
  return provider.create({ cwd, base, head: branch, title, body });
}
