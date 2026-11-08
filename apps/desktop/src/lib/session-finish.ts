import type { ChangesCommitted, DiffFile } from "@flightdeck/protocol";
import type { T } from "../i18n/index.ts";

/** What `changes.get` sends for a file over its size limit: shown, never committed from the app. */
const TOO_LARGE = "too-large";

/** A file the app can commit: the host sent its digest, and it is not over the size limit. */
export function committable(file: DiffFile): boolean {
  return file.digest !== undefined && file.digest !== TOO_LARGE;
}

/** `Update a.txt` → `update-a-txt`: a branch name's last part. */
function slug(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 40)
    .replace(/^-+|-+$/g, ""); // NOSONAR: the replace before made every run of other characters one "-", so at most one at each end
}

/** The message and the branch a commit of `paths` starts from; the person edits both. */
export function draftCommit(t: T, paths: string[]): { message: string; branch: string } {
  const message =
    paths.length === 1
      ? t("sessionFinish.draftOne", { path: paths[0] ?? "" })
      : t("sessionFinish.draftMany", { n: paths.length });
  return { message, branch: `session/${slug(message) || "changes"}` };
}

/** The PR's title and description, from the commit the app made: the person edits both. */
export function draftPr(t: T, message: string, files: string[]): { title: string; body: string } {
  const [first = "", ...rest] = message.split("\n");
  const list = [t("sessionFinish.prFiles"), ...files.map((file) => `- ${file}`)].join("\n");
  const more = rest.join("\n").trim();
  return { title: first.trim(), body: more ? `${more}\n\n${list}` : list };
}

/**
 * The commits the app made, by host and target: Open PR stays offered when the person leaves the
 * tab and comes back. The host keeps its own record and refuses a branch it did not make.
 */
const made = new Map<string, ChangesCommitted & { message: string }>();

export function rememberCommit(key: string, commit: ChangesCommitted & { message: string }): void {
  made.set(key, commit);
}

export function recallCommit(key: string): (ChangesCommitted & { message: string }) | null {
  return made.get(key) ?? null;
}
