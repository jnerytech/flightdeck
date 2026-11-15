import { lstat, mkdir, readdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { KnowledgeEntry, KnowledgeKind } from "@flightdeck/protocol";
import { FlightdeckError, samePath } from "../kernel/index.ts";
import { cleanBody, fileSlug, NUMBERED, oneLine, slugOf, textOf } from "./domain/doc-text.ts";
import { parseKnowledge } from "./domain/parse.ts";
import { shownHash } from "./list.ts";

/**
 * Issue #1039: a new library document from a template, written into the project's folder for its
 * kind, never over a file that is there, and left uncommitted for the person. The title goes only
 * into the heading (never the front matter) and into the file name, in plain ASCII.
 */

/** Tries to take a number another writer took first. */
const ATTEMPTS = 3;

const refuse = (
  code: "bad_request" | "file_conflict",
  reason: string,
  message: string,
  params?: Record<string, string>,
) => new FlightdeckError(code, message, reason, params);

/** One level of the library path: a real folder, made when it is not there. */
async function ensureFolder(path: string): Promise<boolean> {
  const info = await lstat(path).catch(() => null);
  if (info === null) {
    const [made] = await Promise.allSettled([mkdir(path)]);
    // Another writer may have made it a moment ago: it is judged again below.
    return (
      made.status === "fulfilled" || (await lstat(path).catch(() => null))?.isDirectory() === true
    );
  }
  return info.isDirectory();
}

/** The folder for the kind, which must be real and lie where its name says inside the root. */
async function libraryFolder(root: string, kind: KnowledgeKind): Promise<string | null> {
  const docs = join(root, "docs");
  const folder = join(docs, kind);
  if (!(await ensureFolder(docs)) || !(await ensureFolder(folder))) return null;
  const [real, at] = await Promise.allSettled([realpath(root), realpath(folder)]);
  if (real.status !== "fulfilled" || at.status !== "fulfilled") return null;
  // The write goes through the resolved folder, so a link swapped in after the check is not followed.
  return samePath(at.value, join(real.value, "docs", kind)) ? at.value : null;
}

/** The next number after the highest `NNNN-` Markdown name in the folder. */
async function nextNumber(folder: string): Promise<number> {
  const names = await readdir(folder);
  const taken = names.flatMap((name) => {
    const found = /^(\d{4,})-.*\.md$/i.exec(name);
    return found?.[1] ? [Number(found[1])] : [];
  });
  return Math.max(0, ...taken) + 1;
}

export async function createKnowledgeDoc(
  root: string,
  kind: KnowledgeKind,
  title: string,
  body = "",
): Promise<KnowledgeEntry> {
  const clean = oneLine(title);
  const slug = fileSlug(slugOf(clean));
  if (slug === "") {
    throw refuse("bad_request", "knowledge_title_invalid", "the title has no letter or digit");
  }
  const folder = await libraryFolder(root, kind);
  if (folder === null) {
    throw refuse(
      "bad_request",
      "knowledge_folder_unsafe",
      `docs/${kind} is a link or lies outside the project`,
    );
  }
  const text = textOf(kind, clean, cleanBody(body));
  for (let attempt = 1; ; attempt++) {
    const number = NUMBERED.has(kind)
      ? `${String(await nextNumber(folder)).padStart(4, "0")}-`
      : "";
    const name = `${number}${slug}.md`;
    const path = `docs/${kind}/${name}`;
    // `wx`: never over a file that is there, and a link left at the name is not followed.
    const [done] = await Promise.allSettled([
      writeFile(join(folder, name), text, { flag: "wx", mode: 0o644 }),
    ]);
    if (done.status === "fulfilled") {
      const bytes = Buffer.from(text);
      const parsed = parseKnowledge(path, text);
      return {
        path,
        title: parsed.title,
        type: parsed.type,
        status: parsed.status,
        supersedes: parsed.supersedes,
        bytes: bytes.length,
        changedAt: new Date().toISOString(),
        problems: parsed.problems,
        warnings: [],
        hash: shownHash(bytes.length, bytes),
      };
    }
    const taken = (done.reason as NodeJS.ErrnoException).code === "EEXIST";
    if (!taken) throw done.reason;
    // A numbered name taken a moment ago by another writer: look again for the next number.
    if (!number || attempt >= ATTEMPTS) {
      throw refuse("file_conflict", "knowledge_exists", `${path} already exists`, { path });
    }
  }
}
