/**
 * Issue #100, slice 1b: the code of a teleported session as one git bundle. It holds the commits
 * HEAD has beyond its base on origin, and a WIP commit of the working tree (changed and untracked
 * files, never ignored ones) built in a temporary index: the person's index and stash are never
 * touched. `git bundle` takes only refs, so the WIP commit is named by a ref of Flightdeck's own
 * (`refs/flightdeck/teleport/<id>`) for the time of the bundle, then the ref goes. No hook,
 * fsmonitor, external diff or signature check (gpg.program) of the repository runs: every call
 * turns them off. The repository's clean filters do run on `add`, as they do on the person's own
 * `git add` (Git LFS needs them).
 */
import { copyFile, lstat, readFile, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { gitLimitedFor } from "../board/command.ts";
import { HEAD, refArg } from "../board/ref-arg.ts";
import { FlightdeckError } from "../errors.ts";
import { git, must, SAFE, TIMEOUT_MS } from "./git.ts";
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
  /** Fires when the daemon stops: the git calls under way are killed with what they started. */
  signal?: AbortSignal;
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
  /** The commit `base` named here: the target checks its origin has it. */
  baseSha: string;
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
const ID = /^[A-Za-z0-9-]{1,64}$/;

const refuse = (reason: string, params?: Record<string, string | number>) =>
  new FlightdeckError("invalid_state", reason.replaceAll("_", " "), reason, params);

/** Whether `dir` (inside `top`) and every folder above it up to `top` are real folders, not links. */
async function realFolders(
  top: string,
  dir: string,
  known: Map<string, boolean>,
): Promise<boolean> {
  if (dir === top || dir === dirname(dir)) return true;
  const cached = known.get(dir);
  if (cached !== undefined) return cached;
  const real =
    (await realFolders(top, dirname(dir), known)) &&
    (await lstat(dir).then(
      (info) => info.isDirectory(),
      () => false,
    ));
  known.set(dir, real);
  return real;
}

/** Whether the files the working tree changes or adds are, together, past `max` bytes. */
async function pastLimit(top: string, names: string, max: number): Promise<boolean> {
  let total = 0;
  const known = new Map<string, boolean>();
  for (const name of names.split("\0")) {
    if (!name) continue;
    const path = join(top, name);
    // A name below a folder that was swapped for a link would be read at the link's target,
    // somewhere outside the repository: only its size would show, but that is still a probe.
    if (!(await realFolders(top, dirname(path), known))) continue;
    // A deleted file has no size; a link counts as itself, never as what it points at.
    total += await lstat(path).then(
      (info) => (info.isFile() ? info.size : 0),
      () => 0,
    );
    if (total > max) return true;
  }
  return false;
}

/**
 * The lines a `git log -p --cc` adds, headers left out. A combined diff (a merge) has one column
 * per parent before each line: a line is added when any column holds a `+`, so a line only the
 * resolution of a conflict wrote (`++`) counts. Only real file headers are skipped, not an added
 * line that happens to start with `++`.
 */
export function addedText(diff: string): string {
  const added: string[] = [];
  let columns = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --")) {
      columns = 0;
      continue;
    }
    const hunk = /^(@{2,}) /.exec(line);
    if (hunk) {
      columns = (hunk[1] as string).length - 1;
      continue;
    }
    if (columns > 0 && line.slice(0, columns).includes("+")) added.push(line.slice(columns));
  }
  return added.join("\n");
}

/** What the bundle starts from: the branch's upstream on origin, else origin's default branch. */
async function baseOf(top: string, signal?: AbortSignal): Promise<string | null> {
  const upstream = await git(
    top,
    ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    {},
    signal,
  );
  if (upstream?.startsWith("origin/")) return upstream;
  const fallback = await git(
    top,
    ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
    {},
    signal,
  );
  if (fallback) return fallback;
  for (const name of ["origin/main", "origin/master"]) {
    if (await git(top, ["rev-parse", "--verify", "--quiet", `refs/remotes/${name}`], {}, signal)) {
      return name;
    }
  }
  return null;
}

/**
 * The code of the session as a bundle. The daemon stopping (`input.signal`) kills the git calls
 * under way and ends the bundle as `teleport_stopped`, with the temporary ref taken off.
 */
export async function bundleCode(input: CodeBundleInput): Promise<CodeBundle> {
  try {
    return await bundle(input);
  } catch (error) {
    if (input.signal?.aborted) throw refuse("teleport_stopped");
    throw error;
  }
}

async function bundle(input: CodeBundleInput): Promise<CodeBundle> {
  const { signal } = input;
  const top = await git(input.cwd, ["rev-parse", "--show-toplevel"], {}, signal);
  const head = top ? await git(top, ["rev-parse", "--verify", "--quiet", HEAD], {}, signal) : null;
  if (!top || !head) throw refuse("teleport_no_git");
  const found = await baseOf(top, signal);
  if (!found) throw refuse("teleport_no_remote");
  if (!ID.test(input.id))
    throw new FlightdeckError("bad_request", "bad package id", "request_invalid");
  const base = refArg(found);
  const baseSha = await must(
    top,
    ["rev-parse", "--verify", "--quiet", `${base}^{commit}`],
    {},
    signal,
  );
  const max = input.maxBytes ?? TELEPORT_MAX_BYTES;
  // Before git writes a thing: the files changed against HEAD (staged or not) and the new ones.
  const changed = await must(top, ["diff", "--no-ext-diff", "--name-only", "-z", HEAD], {}, signal);
  const untracked = await must(
    top,
    ["ls-files", "-z", "--others", "--exclude-standard"],
    {},
    signal,
  );
  if (await pastLimit(top, `${changed}\0${untracked}`, max)) {
    throw refuse("teleport_too_large", { max });
  }
  const branch = await git(top, ["symbolic-ref", "--quiet", "--short", HEAD], {}, signal);
  // The working tree as a commit, through a copy of the index: the person's index stays as it is.
  const index = join(input.folder, "index");
  const real = await must(
    top,
    ["rev-parse", "--path-format=absolute", "--git-path", "index"],
    {},
    signal,
  );
  await copyFile(real, index).catch(() => {});
  const env = { GIT_INDEX_FILE: index, ...AUTHOR };
  await must(top, ["add", "-A"], env, signal);
  const tree = await must(top, ["write-tree"], env, signal);
  await rm(index, { force: true });
  const wip = await must(
    top,
    ["commit-tree", tree, "-p", head, "-m", "flightdeck teleport: the working tree"],
    AUTHOR,
    signal,
  );
  const ref = `refs/flightdeck/teleport/${input.id}`;
  const file = join(input.folder, "code");
  try {
    // Inside the try: an abort that kills update-ref after the ref is in place still removes it.
    await must(top, ["update-ref", ref, wip], {}, signal);
    await must(top, ["bundle", "create", "-q", file, ref, `^${base}`], {}, signal);
  } finally {
    // git-arg: the ref is made here, from a package id checked against ID
    await git(top, ["update-ref", "-d", ref]);
  }
  const { size } = await stat(file);
  if (size > max) {
    await rm(file, { force: true });
    throw refuse("teleport_too_large", { max });
  }
  const bytes = await readFile(file);
  const ahead = Number(await must(top, ["rev-list", "--count", `${base}..${head}`], {}, signal));
  const names = await must(
    top,
    ["diff", "--no-ext-diff", "--name-only", "-z", head, wip],
    {},
    signal,
  );
  // Everything that moves, commit by commit: a secret one commit added and a later one removed
  // still travels in the bundle. Only added lines.
  // The text is read up to `max`: past it, the scan would count only part of what moves.
  // git-arg: base comes from refArg, wip from commit-tree
  const moved = await gitLimitedFor(
    top,
    max,
    [
      ...SAFE,
      "log",
      "-p",
      "--cc",
      "--no-ext-diff",
      "--no-textconv",
      "--no-color",
      "--format=",
      `${base}..${wip}`,
    ],
    TIMEOUT_MS,
  );
  if (moved.truncated) throw refuse("teleport_too_large", { max });
  // A git that failed or ran out of time (killed at TIMEOUT_MS).
  if (moved.code !== 0) throw new FlightdeckError("internal", "git log failed", "teleport_git");
  const added = addedText(moved.stdout);
  return {
    file,
    ref,
    size,
    sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
    branch,
    head,
    base,
    baseSha,
    ahead,
    changed: names.split("\0").filter(Boolean).length,
    secrets: await secretLines(added, input.scan),
  };
}
