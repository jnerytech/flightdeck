/**
 * Issue #100, slice 1b: the code of a teleported session as one git bundle. It holds the commits
 * HEAD has beyond its base on origin, and a WIP commit of the working tree (changed and untracked
 * files, never ignored ones) built in a temporary index: the person's index and stash are never
 * touched. `git bundle` takes only refs, so the WIP commit is named by a ref of Flightdeck's own
 * (`refs/flightdeck/teleport/<id>`) for the time of the bundle, then the ref goes. No hook of the
 * repository runs: every call sets `core.hooksPath` to nothing.
 */
import { copyFile, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { killTree, runCommand } from "../board/command.ts";
import { HEAD, refArg } from "../board/ref-arg.ts";
import { FlightdeckError } from "../errors.ts";
import { whichOnPath } from "../which.ts";
import { secretLines, TELEPORT_MAX_BYTES } from "./secrets.ts";

export interface CodeBundleInput {
  /** The session's folder: anywhere inside the repository. */
  cwd: string;
  /** The package's private folder: the bundle and the temporary index go there. */
  folder: string;
  /** The package's id: it names the ref the bundle carries. */
  id: string;
  scan(text: string): string[];
  maxBytes?: number;
}

export interface CodeBundle {
  file: string;
  /** The ref the bundle carries: the WIP commit. */
  ref: string;
  size: number;
  sha256: string;
  /** The branch checked out, or null on a detached HEAD. */
  branch: string | null;
  head: string;
  /** What the bundle starts from: the target fetches it from its own origin. */
  base: string;
  /** Commits of HEAD past the base. */
  ahead: number;
  /** Files the working tree changes against HEAD (untracked ones included). */
  changed: number;
  /** Lines of those changes that look like secrets: counts and kinds, never the text. */
  secrets: { lines: number; labels: string[] };
}

/** The WIP commit's author and committer: a host without `user.name` can still make it. */
const AUTHOR = {
  GIT_AUTHOR_NAME: "Flightdeck",
  GIT_AUTHOR_EMAIL: "teleport@flightdeck.invalid",
  GIT_COMMITTER_NAME: "Flightdeck",
  GIT_COMMITTER_EMAIL: "teleport@flightdeck.invalid",
};
const TIMEOUT_MS = 120_000;
const ID = /^[A-Za-z0-9-]{1,64}$/;

const refuse = (reason: string, params?: Record<string, string | number>) =>
  new FlightdeckError("invalid_state", reason.replaceAll("_", " "), reason, params);

/** One git call in `cwd`, with no hook of the repository; null when it fails. */
async function git(
  cwd: string,
  args: string[],
  env: Record<string, string> = {},
): Promise<string | null> {
  // git-arg: a forwarder: every caller passes a checked revision (refArg/HEAD) or a value git gave
  const result = await runCommand(
    [whichOnPath("git") ?? "git", "-c", "core.hooksPath=/dev/null", ...args],
    cwd,
    undefined,
    TIMEOUT_MS,
    killTree,
    env,
  );
  return result.code === 0 ? result.stdout.trim() : null;
}

/** Like `git`, but a failure is an error with git's own exit. */
async function must(
  cwd: string,
  args: string[],
  env: Record<string, string> = {},
): Promise<string> {
  const out = await git(cwd, args, env);
  if (out === null) throw new FlightdeckError("internal", `git ${args[0]} failed`, "teleport_git");
  return out;
}

/** What the bundle starts from: the branch's upstream on origin, else origin's default branch. */
async function baseOf(top: string): Promise<string | null> {
  const upstream = await git(top, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  if (upstream?.startsWith("origin/")) return upstream;
  const fallback = await git(top, [
    "symbolic-ref",
    "--quiet",
    "--short",
    "refs/remotes/origin/HEAD",
  ]);
  if (fallback) return fallback;
  for (const name of ["origin/main", "origin/master"]) {
    if (await git(top, ["rev-parse", "--verify", "--quiet", `refs/remotes/${name}`])) return name;
  }
  return null;
}

export async function bundleCode(input: CodeBundleInput): Promise<CodeBundle> {
  const top = await git(input.cwd, ["rev-parse", "--show-toplevel"]);
  const head = top ? await git(top, ["rev-parse", "--verify", "--quiet", HEAD]) : null;
  if (!top || !head) throw refuse("teleport_no_git");
  const found = await baseOf(top);
  if (!found) throw refuse("teleport_no_remote");
  if (!ID.test(input.id))
    throw new FlightdeckError("bad_request", "bad package id", "request_invalid");
  const base = refArg(found);
  const branch = await git(top, ["symbolic-ref", "--quiet", "--short", HEAD]);
  // The working tree as a commit, through a copy of the index: the person's index stays as it is.
  const index = join(input.folder, "index");
  const real = await must(top, ["rev-parse", "--path-format=absolute", "--git-path", "index"]);
  await copyFile(real, index).catch(() => {});
  const env = { GIT_INDEX_FILE: index, ...AUTHOR };
  await must(top, ["add", "-A"], env);
  const tree = await must(top, ["write-tree"], env);
  await rm(index, { force: true });
  const wip = await must(
    top,
    ["commit-tree", tree, "-p", head, "-m", "flightdeck teleport: the working tree"],
    AUTHOR,
  );
  const ref = `refs/flightdeck/teleport/${input.id}`;
  const file = join(input.folder, "code");
  await must(top, ["update-ref", ref, wip]);
  try {
    await must(top, ["bundle", "create", "-q", file, ref, `^${base}`]);
  } finally {
    // git-arg: the ref is made here, from a package id checked against ID
    await git(top, ["update-ref", "-d", ref]);
  }
  const max = input.maxBytes ?? TELEPORT_MAX_BYTES;
  const { size } = await stat(file);
  if (size > max) {
    await rm(file, { force: true });
    throw refuse("teleport_too_large", { max });
  }
  const bytes = await readFile(file);
  const ahead = Number(await must(top, ["rev-list", "--count", `${base}..${head}`]));
  const names = await must(top, ["diff", "--name-only", head, wip]);
  // Everything that moves: the commits past the base and the working tree. Only added lines.
  const moved = await must(top, ["diff", "--no-color", base, wip]);
  const added = moved
    .split("\n")
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .join("\n");
  return {
    file,
    ref,
    size,
    sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
    branch,
    head,
    base,
    ahead,
    changed: names ? names.split("\n").length : 0,
    secrets: secretLines(added, input.scan),
  };
}
