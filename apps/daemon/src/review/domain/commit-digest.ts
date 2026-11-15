import { createHash } from "node:crypto";

/** A chosen file is read whole for the secret scan: past this, it is refused instead. */
export const MAX_SCAN = 8 * 1024 * 1024;

/** The digest of a file over the size a commit checks: it is never read to make one. */
export const TOO_LARGE = "too-large";

/** A chosen file as it was read: its bytes, or a link's text. */
export interface Read {
  data: Buffer;
  link: boolean;
}

/** The digest of a link: what it points at as text, never the file it reaches. */
export function linkDigest(target: string): string {
  return createHash("sha256").update(`link\0${target}`).digest("hex");
}

/** The digest of what is neither a file nor a link (a pipe, a device): its mode, never its content. */
export function otherDigest(mode: number): string {
  return createHash("sha256").update(`other\0${mode}`).digest("hex");
}

/** The digest the app was sent for a file as read now: its bytes, a link's target, or deleted. */
export function digestOfRead(bytes: Read | null): string {
  if (bytes === null) return "deleted";
  if (bytes.link) return linkDigest(bytes.data.toString("utf8"));
  return createHash("sha256").update(bytes.data).digest("hex");
}

/**
 * The hooks a commit from the app runs: the commit's own, and those the new branch's switch, the
 * ref update and the index write run; then `pre-push`, which the PR's push runs.
 */
export const COMMIT_HOOKS = [
  "pre-commit",
  "prepare-commit-msg",
  "commit-msg",
  "post-commit",
  "post-checkout",
  "reference-transaction",
  "post-index-change",
  "pre-push",
];

/**
 * The hooks that run, from the `stat` of each of `COMMIT_HOOKS` in the same order (null when the
 * file is not there): a file, and executable outside Windows, where every file runs.
 */
export function hooksThatRun(
  infos: ReadonlyArray<{ isFile(): boolean; mode: number } | null>,
  win32: boolean,
): string[] {
  return COMMIT_HOOKS.filter((_, i) => {
    const info = infos[i];
    const runs = win32 || ((info?.mode ?? 0) & 0o111) !== 0;
    return info?.isFile() === true && runs;
  });
}

/** What git leaves in its folder while an operation is half done, and the operation each one marks. */
export const IN_PROGRESS_MARKS: ReadonlyArray<readonly [string, string]> = [
  ["MERGE_HEAD", "merge"],
  ["rebase-merge", "rebase"],
  ["rebase-apply", "rebase"],
  ["CHERRY_PICK_HEAD", "cherry-pick"],
  ["REVERT_HEAD", "revert"],
];

/** Which operation is half done, from the marks present in git's folder: the first in table order. */
export function inProgressState(present: ReadonlySet<string>): string | null {
  for (const [mark, state] of IN_PROGRESS_MARKS) if (present.has(mark)) return state;
  return null;
}
