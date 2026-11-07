import { lstat, open, readdir } from "node:fs/promises";
import { posix } from "node:path";
import type { KnowledgeEntry, KnowledgeListResult } from "@flightdeck/protocol";
import { credential } from "../permissions/sensitive-paths.ts";
import { parseKnowledge } from "./parse.ts";

/**
 * Issue #76: a project's library of documents (PRDs, RFCs, ADRs, specs), listed read only. The
 * folders are fixed; a file, a folder or a name that is a link is never followed, a credential's
 * name is left out, and only the start of each document is read (its status is in the front
 * matter), so a large file costs one small read.
 */
export interface KnowledgeOptions {
  /** At most this many documents; 500 when absent. */
  maxFiles?: number;
}

const FOLDERS = ["docs/decisions", "docs/adr", "docs/rfc", "docs/prd", "docs/specs"];
const SKIPPED = new Set([".git", "node_modules"]);
const MAX_FILES = 500;
/** The most of a document read: its front matter, its heading and the links near its top. */
const READ_BYTES = 8 * 1024;
/** Folders deeper than this are not walked. */
const MAX_DEPTH = 6;
/** The most directory entries looked at in all, so a huge tree costs a bounded walk. */
const MAX_SCANNED = 5_000;
/** `](./other.md)` or `](other.md#part)`: a link to a Markdown file in the project. */
const LINK = /\]\(([^)\s#]+\.md)(?:#[^)\s]*)?\)/gi;

/** Byte order of two names, as git sorts paths. */
const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The Markdown files below `dir` (a path from the root, with `/`), links and skipped folders left out. */
async function walk(
  root: string,
  dir: string,
  depth: number,
  found: string[],
  seen: { n: number },
) {
  const [listed] = await Promise.allSettled([readdir(`${root}/${dir}`, { withFileTypes: true })]);
  if (listed.status !== "fulfilled" || depth > MAX_DEPTH) return;
  for (const entry of listed.value.sort((a, b) => order(a.name, b.name))) {
    if (seen.n++ > MAX_SCANNED) return;
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory() && !SKIPPED.has(entry.name)) {
      await walk(root, path, depth + 1, found, seen);
    } else if (entry.isFile() && /\.md$/i.test(entry.name) && !credential(path)) {
      found.push(path);
    }
  }
}

/** The start of the file as text, its real size and when it changed. */
async function readStart(file: string) {
  const handle = await open(file, "r");
  try {
    const info = await handle.stat();
    const buffer = Buffer.alloc(Math.min(READ_BYTES, info.size));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return {
      text: buffer.toString("utf8", 0, bytesRead),
      bytes: info.size,
      changedAt: new Date(info.mtimeMs).toISOString(),
    };
  } finally {
    await handle.close();
  }
}

/** The project paths a document links to (its own folder is the base), the web and absolute ones left out. */
function linksOf(path: string, text: string): string[] {
  const base = posix.dirname(path);
  const targets: string[] = [];
  for (const match of text.matchAll(LINK)) {
    const link = match[1] ?? "";
    if (/^[a-z][a-z0-9+.-]*:|^\//i.test(link)) continue;
    targets.push(posix.normalize(posix.join(base, link)));
  }
  return targets;
}

export async function listKnowledge(
  root: string,
  opts: KnowledgeOptions = {},
): Promise<KnowledgeListResult> {
  const found: string[] = [];
  const seen = { n: 0 };
  for (const folder of FOLDERS) {
    // A folder that is a link would lead out of the project.
    const [info] = await Promise.allSettled([lstat(`${root}/${folder}`)]);
    if (info.status === "fulfilled" && info.value.isDirectory()) {
      await walk(root, folder, 0, found, seen);
    }
  }
  found.sort(order);
  const max = opts.maxFiles ?? MAX_FILES;
  const read = new Map<string, { text: string; entry: KnowledgeEntry }>();
  for (const path of found.slice(0, max)) {
    const start = await readStart(`${root}/${path}`);
    const parsed = parseKnowledge(path, start.text);
    read.set(path, {
      text: start.text,
      entry: {
        path,
        title: parsed.title,
        type: parsed.type,
        status: parsed.status,
        supersedes: parsed.supersedes,
        bytes: start.bytes,
        changedAt: start.changedAt,
        problems: parsed.problems,
        warnings: [],
      },
    });
  }
  for (const { text, entry } of read.values()) {
    if (entry.supersedes !== null && !read.has(posix.normalize(entry.supersedes))) {
      entry.problems.push("supersedes_missing");
    }
    if (entry.status !== "valid") continue;
    const obsolete = new Set(
      linksOf(entry.path, text).filter((target) => read.get(target)?.entry.status === "obsolete"),
    );
    entry.warnings = [...obsolete].sort(order).map((target) => `references_obsolete:${target}`);
  }
  return { entries: [...read.values()].map((r) => r.entry), truncated: found.length > max };
}
