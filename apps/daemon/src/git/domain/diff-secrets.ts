import type { DiffFile } from "@flightdeck/protocol";
import { credential, maskConfig, maskedConfig } from "../../permissions/index.ts";

/** A file git does not track yet, before its content is known. */
export const newFile = (path: string, binary: boolean): DiffFile => ({
  path,
  oldPath: null,
  status: "added",
  additions: 0,
  deletions: 0,
  uncommitted: true,
  binary,
  hunks: [],
});

/** A file that may hold a credential (issues #449, #509): listed with its mark, no lines, no counts. */
export const secretFile = (file: DiffFile): DiffFile => ({
  ...file,
  secret: true,
  additions: 0,
  deletions: 0,
  hunks: [],
});

/** A credential file that is shown anyway, its private values masked (#806): `.mcp.json`. */
export const unlisted = (path: string) => credential(path) && !maskedConfig(path);

const masks = (text: string) => text.split('"[redacted]"').length;

/**
 * A config's hunks with their private values masked; the command it runs stays readable. The old
 * side (context and removed lines) and the new side (context and added lines) are masked as two
 * texts, each as a hunk may open anywhere in it; a context line keeps the stricter of its two.
 */
export const maskedFile = (file: DiffFile): DiffFile => ({
  ...file,
  hunks: file.hunks.map((hunk) => {
    const old = maskConfig(
      hunk.lines.filter((line) => line.op !== "+").map((line) => line.text),
      true,
    );
    const now = maskConfig(
      hunk.lines.filter((line) => line.op !== "-").map((line) => line.text),
      true,
    );
    let o = 0;
    let n = 0;
    return {
      ...hunk,
      header: maskConfig([hunk.header], true)[0] ?? hunk.header,
      lines: hunk.lines.map((line) => {
        const before = line.op === "+" ? "" : (old[o++] ?? "");
        const after = line.op === "-" ? "" : (now[n++] ?? "");
        const text =
          line.op === "+" || (line.op === " " && masks(after) > masks(before)) ? after : before;
        return { ...line, text };
      }),
    };
  }),
});

/**
 * The files of a diff, with the content of every credential file, old path or new, left out; a
 * config shown masked keeps its lines, masked.
 */
export const withoutSecrets = (files: DiffFile[]) =>
  files.map((file) => {
    if (unlisted(file.path) || (file.oldPath !== null && unlisted(file.oldPath))) {
      return secretFile(file);
    }
    const shown = maskedConfig(file.path) || (file.oldPath !== null && maskedConfig(file.oldPath));
    return shown ? maskedFile(file) : file;
  });
