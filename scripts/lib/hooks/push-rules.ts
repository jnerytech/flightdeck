/**
 * The merge and push rules of the hooks: who may merge, tag or release by hand (#271) and which
 * `git push` a session may run (#218). Pure: the command and the git answers come in as arguments.
 */
import type { CommitGateDeps } from "./commit-rules.ts";
import type { GitCall } from "./shell-parse.ts";
import { commandWords, gitCalls } from "./shell-parse.ts";

/**
 * Why a `bun run pr -- merge|tag`, a `gh pr merge` or a REST merge is blocked (#271): sessions
 * open their PRs and turn on auto-merge; merging by hand and tagging are the coordinator's
 * (`FLIGHTDECK_COORDINATOR=1` in the hook's own environment, not one set in the command).
 */
export function prMergeViolation(
  command: string,
  env: Record<string, string | undefined>,
): string | null {
  if (env.FLIGHTDECK_COORDINATOR) return null;
  for (const segment of commandWords(command).split(/[;&|\n]+/)) {
    const what = handMerge(segment.trim().split(/\s+/));
    if (what) {
      return `${what} is the coordinator's: a session opens its PR and turns on auto-merge, \`bun run pr -- auto <n>\` (CLAUDE.md).`;
    }
  }
  return null;
}

/** The hand merge or tag one command's words run, or null. */
function handMerge(words: string[]): string | null {
  const g = words.indexOf("gh");
  if (g >= 0 && words[g + 1] === "pr" && words[g + 2] === "merge") return "gh pr merge";
  if (g >= 0 && words[g + 1] === "api" && words.some((w) => /\/pulls\/\d+\/merge$/.test(w))) {
    return "a REST merge";
  }
  if (releaseCommand(words)) return "bun run release";
  if (releaseCloseApply(words)) return "bun run release:close --apply";
  const sub = prFlowCommand(words);
  return sub === "merge" || sub === "tag" ? `bun run pr -- ${sub}` : null;
}

/** True for `bun run release` (or `bun scripts/release-cmd.ts`): it pushes a branch and tags (#275). */
function releaseCommand(words: string[]): boolean {
  const b = words.indexOf("bun");
  if (b < 0) return false;
  const [first, second] = words.slice(b + 1);
  return (first === "run" && second === "release") || (first?.endsWith("release-cmd.ts") ?? false);
}

/** True for `bun run release:close ... --apply` (or `bun scripts/release-close.ts ...`): it closes issues on GitHub (#287). */
function releaseCloseApply(words: string[]): boolean {
  const b = words.indexOf("bun");
  if (b < 0) return false;
  const [first, second] = words.slice(b + 1);
  const closes =
    (first === "run" && second === "release:close") ||
    (first?.endsWith("release-close.ts") ?? false);
  return closes && words.includes("--apply");
}

/** The `bun run pr` (or `bun scripts/pr-flow.ts`) command these words run, or undefined. */
function prFlowCommand(words: string[]): string | undefined {
  const b = words.indexOf("bun");
  if (b < 0) return undefined;
  const rest = words.slice(b + 1);
  let at = -1;
  if (rest[0] === "run" && rest[1] === "pr") at = 2;
  else if (rest[0]?.endsWith("pr-flow.ts")) at = 1;
  return at < 0 ? undefined : rest.slice(at).find((w) => w !== "--");
}

export interface PushGuardDeps extends CommitGateDeps {
  /** The hook's own environment: `FLIGHTDECK_COORDINATOR=1` marks the session that may push all. */
  env: Record<string, string | undefined>;
}

/**
 * Why a `git push` is blocked (#218): sessions push only their own work branches. Pushing main,
 * an rc/* branch or a tag, `--tags`/`--all`/`--mirror`, a bare `--force` or a `+` refspec, and a
 * `--force-with-lease` to any branch but the one checked out are blocked. The coordinator
 * (`FLIGHTDECK_COORDINATOR=1` in the hook's environment) and other repositories pass.
 */
export function pushViolation(command: string, cwd: string, deps: PushGuardDeps): string | null {
  if (deps.env.FLIGHTDECK_COORDINATOR) return null;
  for (const call of gitCalls(command, cwd)) {
    if (call.sub !== "push" || call.dir === null) continue;
    if (deps.inProject && !deps.inProject(call.dir)) continue;
    const dir = call.dir;
    const reason = pushRuleViolation(
      call.args.map((a) => a.value),
      (args) => deps.git(args, dir),
    );
    if (reason) return reason;
  }
  return null;
}

/**
 * The branches a push updates (#756 review): each refspec's destination, or HEAD's branch for a
 * bare push. None for a delete; a tag and a release-v* branch never wait.
 */
export function pushedBranches(call: GitCall, git: (args: string[]) => string | null): string[] {
  const words = readPushWords(call.args.map((a) => a.word));
  if (words.deleting) return [];
  const current = git(["symbolic-ref", "--short", "HEAD"])?.trim() || null;
  const refspecs = words.positional.slice(1);
  const targets: PushTarget[] =
    refspecs.length === 0
      ? [{ dst: current, tag: false, plus: false }]
      : refspecs.map((spec) => pushTarget(spec, false, current, git));
  return targets.flatMap(({ dst, tag }) =>
    dst && !tag && !dst.startsWith("release-v") ? [dst] : [],
  );
}

const OWN_BRANCHES =
  "sessions push only their own work branches; the coordinator pushes main, rc/* and tags (CLAUDE.md).";
/** `git push` options that take their value as the next word. */
const PUSH_OPTIONS_WITH_VALUE = new Set([
  "-o",
  "--push-option",
  "--repo",
  "--receive-pack",
  "--exec",
]);

interface PushWords {
  /** The refusal for a flag that is blocked outright (`--tags`, `--mirror`...). */
  blocked: string | null;
  positional: string[];
  bareForce: boolean;
  lease: boolean;
  deleting: boolean;
}

/** The words after `git push`, sorted into the remote and refspecs, and the flags the rules look at. */
function readPushWords(args: string[]): PushWords {
  const words: PushWords = {
    blocked: null,
    positional: [],
    bareForce: false,
    lease: false,
    deleting: false,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? "";
    if (a.includes('"') || a.includes("'")) continue;
    if (["--tags", "--all", "--mirror", "--follow-tags"].includes(a)) {
      return { ...words, blocked: `git push ${a} is blocked: ${OWN_BRANCHES}` };
    }
    if (a === "-f" || a === "--force") words.bareForce = true;
    else if (a.startsWith("--force-with-lease") || a === "--force-if-includes") words.lease = true;
    else if (a === "-d" || a === "--delete") words.deleting = true;
    else if (PUSH_OPTIONS_WITH_VALUE.has(a)) i++;
    else if (!a.startsWith("-")) words.positional.push(a);
  }
  return words;
}

type PushTarget = { dst: string | null; tag: boolean; plus: boolean };

/** Where one refspec pushes to: the branch (or tag) it names, and whether it forces with a `+`. */
function pushTarget(
  spec: string,
  deleting: boolean,
  current: string | null,
  git: (args: string[]) => string | null,
): PushTarget {
  const plus = spec.startsWith("+");
  const bare = plus ? spec.slice(1) : spec;
  const colon = bare.indexOf(":");
  const src = colon < 0 ? bare : bare.slice(0, colon);
  let dst = deleting || colon < 0 ? bare : bare.slice(colon + 1);
  if (dst.startsWith("refs/tags/")) return { dst, tag: true, plus };
  dst = dst.replace(/^refs\/heads\//, "");
  if (dst === "HEAD") return { dst: current, tag: false, plus };
  const tag =
    colon < 0 && !deleting && git(["show-ref", "--verify", "--quiet", `refs/tags/${src}`]) !== null;
  return { dst, tag, plus };
}

/** Why one push target is refused (a tag, main or an rc branch, a force, a lease elsewhere), or null. */
function targetViolation(target: PushTarget, words: PushWords, current: string | null) {
  const { dst, tag, plus } = target;
  if (tag) return `git push of the tag ${dst} is blocked: ${OWN_BRANCHES}`;
  if (dst === null) return null;
  if (dst === "main" || dst.startsWith("rc/")) {
    return `git push to ${dst} is blocked: ${OWN_BRANCHES}`;
  }
  if (words.bareForce || plus) {
    return `git push --force is blocked: use --force-with-lease, and only on the branch checked out here (${current ?? "none"}).`;
  }
  if (words.lease && dst !== current) {
    return `git push --force-with-lease to ${dst} is blocked: force only the branch checked out here (${current ?? "none"}); ${OWN_BRANCHES}`;
  }
  return null;
}

/** The rules of `pushViolation` for one `git push` with these words after `push`. */
function pushRuleViolation(args: string[], git: (args: string[]) => string | null): string | null {
  const words = readPushWords(args);
  if (words.blocked) return words.blocked;
  const current = git(["symbolic-ref", "--short", "HEAD"])?.trim() || null;
  const refspecs = words.positional.slice(1);
  const targets: PushTarget[] =
    refspecs.length === 0
      ? [{ dst: current, tag: false, plus: false }]
      : refspecs.map((spec) => pushTarget(spec, words.deleting, current, git));
  for (const target of targets) {
    const violation = targetViolation(target, words, current);
    if (violation) return violation;
  }
  return null;
}
