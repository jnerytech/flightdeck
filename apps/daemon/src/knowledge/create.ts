import { lstat, mkdir, readdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { KnowledgeEntry, KnowledgeKind } from "@flightdeck/protocol";
import { FlightdeckError } from "../errors.ts";
import { samePath } from "../paths.ts";
import { shownHash } from "./list.ts";
import { parseKnowledge } from "./parse.ts";

/**
 * Issue #1039: a new library document from a template, written into the project's folder for its
 * kind, never over a file that is there, and left uncommitted for the person. The title goes only
 * into the heading (never the front matter) and into the file name, in plain ASCII.
 */

const SECTIONS: Record<KnowledgeKind, readonly string[]> = {
  adr: [
    "Context\n\nWhat is the problem, and what forces are at play?",
    "Decision\n\nWhat did we decide?",
    "Consequences\n\nWhat becomes easier, and what becomes harder?",
  ],
  rfc: [
    "Summary\n\nOne paragraph: what is proposed.",
    "Motivation\n\nWhy now, and for whom?",
    "Proposal\n\nThe design, in enough detail to be reviewed.",
    "Alternatives considered\n\nWhat else was weighed, and why not.",
    "Open questions\n\nWhat is still undecided.",
  ],
  prd: [
    "Problem\n\nWho has it, and what does it cost them?",
    "Goals\n\nWhat must be true when this ships.",
    "Non-goals\n\nWhat this does not try to do.",
    "Requirements\n\nThe behaviour, as a list a test can check.",
    "Success criteria\n\nHow we will know it worked.",
  ],
};

/** An ADR or an RFC is numbered in its folder; a PRD is named by its title alone. */
const NUMBERED: ReadonlySet<KnowledgeKind> = new Set(["adr", "rfc"]);
const TITLE_MAX = 120;
const SLUG_MAX = 60;
/** Tries to take a number another writer took first. */
const ATTEMPTS = 3;

const refuse = (
  code: "bad_request" | "file_conflict",
  reason: string,
  message: string,
  params?: Record<string, string>,
) => new FlightdeckError(code, message, reason, params);

/** The title on one line: controls, line breaks and direction marks become a space. */
const oneLine = (title: string) =>
  title
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\s]+/gu, " ")
    .trim()
    .slice(0, TITLE_MAX)
    .trim();

/** Lowercase ASCII words joined by `-`, accents folded; empty when nothing is left. */
const slugOf = (title: string) =>
  title
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/, "");

/** Windows opens these names as devices whatever the extension: `nul.md` is no file. */
const DEVICE_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/;
const fileSlug = (slug: string) => (DEVICE_NAME.test(slug) ? `${slug}-doc` : slug);

const textOf = (kind: KnowledgeKind, title: string) =>
  `---\nstatus: transitional\n---\n# ${title}\n\n${SECTIONS[kind].map((s) => `## ${s}`).join("\n\n")}\n`;

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
  const text = textOf(kind, clean);
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
