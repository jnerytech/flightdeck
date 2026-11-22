/**
 * Issue #3701: what `flightdeckd snapshots` and `rewind preview` print, as pure rules over the daemon's
 * answers. The text is one line for each snapshot or file; `--json` keeps the fields a script reads and leaves
 * out the repository path and the git ref, which only the daemon uses.
 */
import type { RewindPreview, SnapshotFiles, SnapshotInfo } from "@flightdeck/protocol";

const PROMPT_WIDTH = 100;

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** The snapshots as a script reads them: the number `snapshots files` and `rewind preview` take, and what it was taken for. */
export const snapshotsJson = (snapshots: SnapshotInfo[]) => ({
  snapshots: snapshots.map(({ n, kind, turnUuid, prompt, createdAt }) => ({
    n,
    kind,
    turnUuid,
    prompt,
    createdAt,
  })),
});

const clip = (text: string) =>
  text.length > PROMPT_WIDTH ? `${text.slice(0, PROMPT_WIDTH - 1)}…` : text;

/** One line for each snapshot: its number, kind, time and the prompt of the turn when it has one. */
export function snapshotsLines(session: string, snapshots: SnapshotInfo[]): string[] {
  if (snapshots.length === 0) return [`${session}: no snapshots`];
  return [
    `${session}: ${plural(snapshots.length, "snapshot", "snapshots")}`,
    ...snapshots.map((s) => {
      const prompt = s.prompt ? ` ${clip(s.prompt)}` : "";
      return `  ${s.n} ${s.kind} ${s.createdAt}${prompt}`;
    }),
  ];
}

/** The head line (`<what>: 2 files, +5 -2`, or `<what>: no file changed`) and one line for each file. */
function changeLines(what: string, changes: SnapshotFiles | RewindPreview): string[] {
  const { files, insertions, deletions } = changes;
  if (files.length === 0) return [`${what}: no file changed`];
  return [
    `${what}: ${plural(files.length, "file", "files")}, +${insertions} -${deletions}`,
    ...files.map((file) => `  ${file.change} ${file.path}`),
  ];
}

/** What a turn changed. */
export const turnFilesLines = (session: string, turn: number, changes: SnapshotFiles): string[] =>
  changeLines(`${session} turn ${turn}`, changes);

const through = (changes: RewindPreview) =>
  changes.via === "sdk" ? "the SDK's checkpoint" : "a snapshot";

/** What a rewind to a turn put back, and through what the daemon did it. */
export const rewoundLines = (session: string, turn: number, done: RewindPreview): string[] =>
  changeLines(`${session} rewound to turn ${turn}, through ${through(done)}`, done);

/** What going back to the state before the last rewind put back. */
export const undoneLines = (session: string, done: RewindPreview): string[] =>
  changeLines(`${session} rewind undone, through ${through(done)}`, done);

/** What going back to the state before the last rewind would change, from the working tree as it is now. */
export const undoPreviewLines = (session: string, preview: RewindPreview): string[] =>
  changeLines(`${session} rewind undo would change`, preview);

/** What a rewind to a turn would change, and through what the daemon would do it. */
export const rewindPreviewLines = (
  session: string,
  turn: number,
  preview: RewindPreview,
): string[] =>
  changeLines(`${session} rewind to turn ${turn}, through ${through(preview)}`, preview);
