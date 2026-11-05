/**
 * Phase 40: what the assistant reads from a repository to write a commit or PR message: the diff
 * (filtered, redacted and within a budget), the repo's own rules about commits, and the style of
 * its recent subjects. Never author names, emails, hashes, or file contents outside the diff.
 */
import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import type {
  AssistantContextBundle,
  CommitSource,
  DiffFile,
  SecretScanner,
} from "@flightdeck/protocol";
import { git } from "../board/command.ts";
import { cardDiff, parseUnifiedDiff, workingDiff } from "../board/diff.ts";
import { FlightdeckError } from "../errors.ts";
import { isCredentialPath } from "../permissions/risk.ts";
import { readRegular } from "../read-regular.ts";
import { REMOVED_LINE } from "../watch/trace.ts";

export interface ContextDeps {
  /** A card's worktree and base branch; refuses a card that does not exist. */
  card(cardId: string): { worktree: string; base: string };
  /** The folder, checked against the allowed roots. */
  allowed(cwd: string): Promise<string>;
  scanner: Pick<SecretScanner, "scan">;
}

/** The most of one file's diff, and of the whole diff, that goes to the model (about 20k tokens). */
const PER_FILE = 6 * 1024;
const TOTAL = 48 * 1024;
/** The most of the repo's rules, of each of its two small files, and of a Markdown file that is read. */
const RULES_MAX = 4096;
const SMALL_FILE_MAX = 1024;
const MARKDOWN_MAX = 64 * 1024;

const LOCKFILES = new Set([
  "bun.lock",
  "bun.lockb",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "Cargo.lock",
  "poetry.lock",
]);

const STAGED = [
  "-c",
  "core.quotePath=false",
  "diff",
  "--cached",
  "--no-color",
  "--no-ext-diff",
  "-M",
];
const CONVENTIONAL = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\(.+\))?!?: /;
const RULE_WORDS = /commit|conventional|scope|pr title|message/i;

function refuse(
  reason: "assistant_no_changes" | "assistant_not_a_repo",
  message: string,
): FlightdeckError {
  return new FlightdeckError("invalid_state", message, reason);
}

/** A file the model is not shown: binary, a lockfile, minified or generated, build output, a credential. */
function hidden(file: DiffFile): boolean {
  const path = file.path.replaceAll("\\", "/");
  const name = basename(path);
  return (
    file.binary ||
    LOCKFILES.has(name) ||
    /\.min\.(js|css)$|\.map$|\.generated\./.test(name) ||
    /(^|\/)(dist|build)\//.test(path) ||
    isCredentialPath(path)
  );
}

/** The repository's top level, or the refusal for a folder that is not in one. */
async function topLevel(cwd: string): Promise<string> {
  const result = await git(cwd, "rev-parse", "--show-toplevel");
  if (result.code !== 0) throw refuse("assistant_not_a_repo", `${cwd} is not a git repository`);
  return result.stdout.trim();
}

async function changes(
  source: CommitSource,
  deps: ContextDeps,
): Promise<{ root: string; files: DiffFile[] }> {
  if (source.kind === "card") {
    const { worktree, base } = deps.card(source.cardId);
    return { root: worktree, files: (await cardDiff(worktree, base)).files };
  }
  const root = await topLevel(await deps.allowed(source.cwd));
  if (source.kind === "worktree") return { root, files: await workingDiff(root) };
  const staged = await git(root, ...STAGED);
  return { root, files: parseUnifiedDiff(staged.stdout, true) };
}

const KEY_BEGIN = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const KEY_END = /-----END [A-Z ]*PRIVATE KEY-----/;

/** One file's diff as the model reads it, its secret-looking lines taken out, and a private key from its BEGIN line to its END line. */
function render(
  file: DiffFile,
  scanner: ContextDeps["scanner"],
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

function stat(files: DiffFile[]): string {
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
function blocks(text: string): string[] {
  const out: string[] = [];
  for (const paragraph of text.split(/\n\s*\n/)) {
    // A list is one block per item: a line that starts an item opens the next one.
    const items = paragraph.split(/\n(?=(?:[-*]|\d+\.) )/);
    for (const item of items) if (RULE_WORDS.test(item)) out.push(item.trim());
  }
  return out;
}

/** The start of a regular file as text; null for a link, a folder, a pipe or a missing file. */
async function head(path: string, max: number): Promise<string | null> {
  return (await readRegular(path, max))?.toString("utf8") ?? null;
}

/**
 * The repo's own rules about commits and PRs: from CLAUDE.md, AGENTS.md, commitlint and
 * .gitmessage. Each is read only when it is a regular file (never through a link), and only its start.
 */
export async function extractRules(root: string): Promise<string> {
  const kept: string[] = [];
  let size = 0;
  for (const name of ["CLAUDE.md", "AGENTS.md"]) {
    const text = await head(join(root, name), MARKDOWN_MAX);
    for (const block of blocks(text ?? "")) {
      if (size + block.length > RULES_MAX) break;
      kept.push(block);
      size += block.length + 2;
    }
  }
  const commitlint = (await readdir(root)).find((name) => name.startsWith("commitlint.config."));
  const extra = await Promise.all([
    commitlint ? head(join(root, commitlint), SMALL_FILE_MAX) : null,
    head(join(root, ".gitmessage"), SMALL_FILE_MAX),
  ]);
  const small = extra.map((part) => part?.trim() ?? "").filter((part) => part !== "");
  return [...kept, ...small].join("\n\n");
}

/** The bundle a commit or PR message is written from. */
export async function repoContext(
  source: CommitSource,
  deps: ContextDeps,
): Promise<AssistantContextBundle> {
  const { root, files } = await changes(source, deps);
  if (files.length === 0) throw refuse("assistant_no_changes", "there are no changes");
  const notShown = files.filter(hidden).map((f) => f.path);
  const rendered = files
    .filter((f) => !hidden(f))
    .map((f) => ({ path: f.path, ...render(f, deps.scanner) }))
    .sort((a, b) => a.text.length - b.text.length || (a.path < b.path ? -1 : 1));
  const shown: string[] = [];
  let total = 0;
  let truncated = false;
  for (const file of rendered) {
    const text = file.text.length > PER_FILE ? `${file.text.slice(0, PER_FILE)}\n[cut]` : file.text;
    if (text !== file.text) truncated = true;
    if (total + text.length > TOTAL) {
      notShown.push(file.path);
      truncated = true;
      continue;
    }
    shown.push(text);
    total += text.length + 1;
  }
  const log = await git(root, "log", "-15", "--format=%s");
  const recent = log.code === 0 ? log.stdout.split("\n").filter(Boolean) : [];
  const conventional =
    recent.length > 0 && recent.filter((s) => CONVENTIONAL.test(s)).length * 2 >= recent.length;
  return {
    stat: stat(files),
    diff: shown.join("\n"),
    notShown: notShown.sort(),
    redactedLines: rendered.reduce((sum, f) => sum + f.redacted, 0),
    truncated,
    rules: await extractRules(root),
    recent,
    conventional,
  };
}
