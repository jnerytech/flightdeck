import { chmod, lstat, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { KnowledgeEntry, KnowledgeStatus } from "@flightdeck/protocol";
import { frontmatter } from "../agentcfg/files.ts";
import { FlightdeckError } from "../errors.ts";
import { readRegularSized } from "../read-regular.ts";
import { ulid } from "../ulid.ts";
import { listKnowledge, READ_BYTES, shownHash } from "./list.ts";
import { parseKnowledge } from "./parse.ts";

/**
 * Issue #76: the `status:` line of a library document, changed from the app. Only that line of
 * the front matter (or a front matter block holding it) is written; the rest of the file is kept
 * byte for byte, and the file is left in the project's folder uncommitted, for the person.
 */

/** The most of a document this will rewrite. */
const MAX_BYTES = 1024 * 1024;
/** The front matter delimiters: the opening line's ending, the lines inside, the closing line. */
const BLOCK = /^---(\r?\n)([\s\S]*?)(\r?\n---(?:\r?\n|$))/;
/** A front matter opened and never closed. */
const OPENED = /^---[ \t]*(?:\r?\n|$)/;
/** The same key written in quotes: not rewritten here, and a second plain one beside it would be a duplicate. */
const QUOTED = /(?<![^\n])["']status["'][ \t]*:/;
/** A top-level `status:` line, from its key to the end of the line. */
const KEY = /(?<![^\n])status[ \t]*:[^\r\n]*(?=\r?\n|$)/g;
/** Such a line holding one plain word, maybe quoted, maybe with a comment: the only shape rewritten. */
const PLAIN = /^(status[ \t]*:[ \t]*)(["'])?[A-Za-z]+\2([ \t]*(?:#[^\r\n]*)?)$/;

/** The text with its front matter saying `status`, or `null` when the front matter is not clear. */
export function withStatus(text: string, status: KnowledgeStatus): string | null {
  const bom = text.startsWith("﻿") ? "﻿" : "";
  const plain = text.slice(bom.length);
  const block = BLOCK.exec(plain);
  if (!block) {
    if (OPENED.test(plain)) return null;
    const eol = plain.includes("\r\n") ? "\r\n" : "\n";
    return `${bom}---${eol}status: ${status}${eol}---${eol}${plain}`;
  }
  const data = frontmatter(plain);
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const [whole, eol = "\n", inner = "", closing = ""] = block;
  const keys = [...inner.matchAll(KEY)];
  let changed = `${inner}${eol}status: ${status}`;
  if (keys.length > 1 || QUOTED.test(inner)) return null;
  const key = keys[0];
  if (key) {
    const line = PLAIN.exec(key[0]);
    if (!line) return null;
    const at = key.index;
    changed = `${inner.slice(0, at)}${line[1]}${status}${line[3]}${inner.slice(at + key[0].length)}`;
  }
  return `${bom}---${eol}${changed}${closing}${plain.slice(whole.length)}`;
}

const refuse = (code: "not_found" | "bad_request", reason: string, file: string) =>
  new FlightdeckError(code, `${file}: ${reason}`, reason, { path: file });

export async function setKnowledgeStatus(
  root: string,
  file: string,
  status: KnowledgeStatus,
  expectedHash: string,
): Promise<KnowledgeEntry> {
  // The list vets the file: a library folder, no link, no credential name, a file of its own.
  const listed = (await listKnowledge(root)).entries.find((entry) => entry.path === file);
  const full = join(root, file);
  const read = listed ? await readRegularSized(full, MAX_BYTES + 1) : null;
  if (!listed || !read) throw refuse("not_found", "review_file_missing", file);
  if (read.size > MAX_BYTES) throw refuse("bad_request", "review_file_big", file);
  const { data: bytes } = read;
  const text = bytes.toString("utf8");
  // Bytes that are not text, or not UTF-8, would not come back the same from a rewrite.
  if (bytes.includes(0) || !Buffer.from(text).equals(bytes))
    throw refuse("bad_request", "review_file_binary", file);
  const head = bytes.subarray(0, READ_BYTES);
  if (shownHash(read.size, head) !== expectedHash) {
    throw new FlightdeckError(
      "file_conflict",
      `${file} changed since it was listed`,
      "review_file_changed",
      { path: file },
    );
  }
  const next = withStatus(text, status);
  const before = parseKnowledge(file, head.toString("utf8"));
  const after = next === null ? null : parseKnowledge(file, headOf(next));
  const same = (p: { title: string; type: unknown; supersedes: unknown; problems: string[] }) =>
    JSON.stringify([
      p.title,
      p.type,
      p.supersedes,
      p.problems.filter((x) => x !== "status_unknown"),
    ]);
  // The new text must read back as the status asked for and as the same document otherwise.
  if (next === null || after?.status !== status || same(after) !== same(before)) {
    throw refuse("bad_request", "knowledge_frontmatter", file);
  }
  if (next === text) return listed;
  // Anything but a plain file by now (swapped in since the read) gets the strictest mode, not its own.
  const info = await lstat(full);
  const mode = info.isFile() ? info.mode & 0o777 : 0o600;
  const tmp = join(dirname(full), `.${basename(full)}.${ulid()}.tmp`);
  try {
    await writeFile(tmp, next, { flag: "wx", mode });
    await chmod(tmp, mode);
    await rename(tmp, full);
  } finally {
    await rm(tmp, { force: true });
  }
  const now = (await listKnowledge(root)).entries.find((entry) => entry.path === file);
  return now ?? listed;
}

/** The start of a text, as the list reads the start of a file. */
const headOf = (text: string) => Buffer.from(text).subarray(0, READ_BYTES).toString("utf8");
