/**
 * Phase 40: how the diff the assistant reads is shaped (#1601): which files the model is not shown,
 * each shown file's diff with its secret-looking lines and private keys taken out, the stat, and the
 * rule blocks that talk about commits. Pure over a diff and a scanner passed in; the reading of the
 * repository and the budget stay in context.ts.
 */
import { basename } from "node:path";
import type { DiffFile, SecretScanner } from "@flightdeck/protocol";
import { isCredentialPath } from "../../permissions/index.ts";
import { REMOVED_LINE } from "../../watch/index.ts";

const LOCKFILES = new Set([
  "bun.lock",
  "bun.lockb",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "Cargo.lock",
  "poetry.lock",
]);

export const CONVENTIONAL =
  /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\(.+\))?!?: /;
const RULE_WORDS = /commit|conventional|scope|pr title|message/i;

/** A file the model is not shown: binary, over the cap, a lockfile, minified or generated, build output, a credential. */
export function hidden(file: DiffFile): boolean {
  const path = file.path.replaceAll("\\", "/");
  const name = basename(path);
  return (
    file.binary ||
    file.tooLarge === true ||
    LOCKFILES.has(name) ||
    /\.min\.(js|css)$|\.map$|\.generated\./.test(name) ||
    /(^|\/)(dist|build)\//.test(path) ||
    isCredentialPath(path) ||
    (file.oldPath !== null && isCredentialPath(file.oldPath.replaceAll("\\", "/")))
  );
}

const KEY_BEGIN = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const KEY_END = /-----END [A-Z ]*PRIVATE KEY-----/;

/** One file's diff as the model reads it, its secret-looking lines taken out, and a private key from its BEGIN line to its END line. */
export function render(
  file: DiffFile,
  scanner: Pick<SecretScanner, "scan">,
): { text: string; redacted: number } {
  let redacted = 0;
  const lines = [`--- ${file.path}`];
  for (const hunk of file.hunks) {
    lines.push(hunk.header);
    let inKey = false;
    for (const line of hunk.lines) {
      const keyLine: boolean = inKey || KEY_BEGIN.test(line.text);
      inKey = keyLine && !KEY_END.test(line.text);
      if (keyLine || scanner.scan(line.text).length > 0) {
        redacted++;
        lines.push(`${line.op}${REMOVED_LINE}`);
      } else {
        lines.push(`${line.op}${line.text}`);
      }
    }
  }
  return { text: lines.join("\n"), redacted };
}

export function stat(files: DiffFile[]): string {
  // Byte order, as git sorts paths.
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : 1));
  const width = Math.max(...sorted.map((f) => f.path.length));
  return sorted
    .map((f) => {
      const bar = `${f.additions > 0 ? "+" : ""}${f.deletions > 0 ? "-" : ""}`;
      return ` ${f.path.padEnd(width)} | ${f.additions + f.deletions} ${bar}`.trimEnd();
    })
    .join("\n");
}

/** The paragraphs and list items of a Markdown file that talk about commits or messages. */
export function blocks(text: string): string[] {
  const out: string[] = [];
  for (const paragraph of text.split(/\n\s*\n/)) {
    // A list is one block per item: a line that starts an item opens the next one.
    const items = paragraph.split(/\n(?=(?:[-*]|\d+\.) )/);
    for (const item of items) if (RULE_WORDS.test(item)) out.push(item.trim());
  }
  return out;
}
