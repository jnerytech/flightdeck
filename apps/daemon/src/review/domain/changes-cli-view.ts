/**
 * Issue #3620: what `flightdeckd changes` prints, as pure rules over the daemon's answers. A `--json` value
 * keeps every key (`null` where an older daemon sends none) and the hunks of every file, as the app shows
 * them. The text lists one line for each file, with the digest a later `commit` repeats, and never the lines
 * of a diff: a file that may hold a credential is listed with no lines by the daemon, and it stays so here.
 */
import type { ChangesResult, DiffFile, FileSession } from "@flightdeck/protocol";

/** The changes as the protocol returns them, with the fields an older daemon leaves out as `null`; no frame type. */
export const changesJson = (result: ChangesResult) => ({
  target: result.target,
  root: result.root,
  base: result.base ?? null,
  position: result.position ?? null,
  hooks: result.hooks ?? [],
  remote: result.remote ?? null,
  files: result.files.map((file) => ({
    ...file,
    oldPath: file.oldPath ?? null,
    tooLarge: file.tooLarge ?? false,
    bytes: file.bytes ?? null,
    secret: file.secret ?? false,
    digest: file.digest ?? null,
  })),
});

/** What the daemon did with a file's lines: the counts, or the reason it has none. */
function detail(file: DiffFile): string {
  if (file.secret) return "may hold a credential, not read";
  if (file.tooLarge)
    return `too large${file.bytes === undefined ? "" : ` (${file.bytes} bytes)`}, not read`;
  if (file.binary) return "binary";
  return `+${file.additions} -${file.deletions}`;
}

function fileLine(file: DiffFile): string {
  const from = file.oldPath ? ` (from ${file.oldPath})` : "";
  const parts = [
    detail(file),
    ...(file.uncommitted ? ["uncommitted"] : []),
    ...(file.digest === undefined ? [] : [`digest ${file.digest}`]),
  ];
  return `  ${file.status} ${file.path}${from} ${parts.join(", ")}`;
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** Where the changes are, where a commit and a PR would go, and one line for each file. */
export function changesLines(result: ChangesResult): string[] {
  const { base, position, files } = result;
  const lines = [`${result.target}: ${result.root}`];
  if (base === null) lines.push("base: none, against HEAD");
  else
    lines.push(
      position
        ? `base: ${base}, ${position.ahead} ahead, ${position.behind} behind`
        : `base: ${base}`,
    );
  if (result.remote !== undefined) lines.push(`remote: ${result.remote}`);
  if (result.hooks && result.hooks.length > 0) lines.push(`hooks: ${result.hooks.join(", ")}`);
  if (files.length === 0) return [...lines, "no changes"];
  const added = files.reduce((sum, file) => sum + file.additions, 0);
  const removed = files.reduce((sum, file) => sum + file.deletions, 0);
  return [
    ...lines,
    `${plural(files.length, "file", "files")}, +${added} -${removed}`,
    ...files.map(fileLine),
  ];
}

/** An update as one line, since the stream flattens a line break: the lines of the list, joined. */
export const changesStreamLine = (result: ChangesResult): string =>
  changesLines(result)
    .map((line) => line.trim())
    .join("; ");

/** The sessions that wrote a file, as the protocol returns them, with a session with no title as `null`. */
export const sessionsJson = (sessions: FileSession[]) => ({
  sessions: sessions.map((session) => ({ ...session, title: session.title ?? null })),
});

export function sessionsLines(path: string, sessions: FileSession[]): string[] {
  if (sessions.length === 0) return [`${path}: no session wrote it`];
  return [
    `${path}: ${plural(sessions.length, "session wrote it", "sessions wrote it")}`,
    ...sessions.map(
      (s) =>
        `  ${s.claudeSessionId}: ${plural(s.edits, "edit", "edits")}, first ${s.firstAt}, last ${s.lastAt}${s.title ? `, ${s.title}` : ""}`,
    ),
  ];
}
