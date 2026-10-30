/**
 * The rules behind the project's Claude Code hooks (.claude/hooks), kept here to be tested.
 * The hooks only read the tool call from stdin and apply these.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

/** git options that take their value as the next word (`git -C <dir> add`). */
const GIT_OPTIONS_WITH_VALUE = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace"]);

/** Paths written by tools, relative to a checkout; a trailing slash means the whole folder. */
const GENERATED = [
  "bun.lock",
  "coverage/",
  "dist/",
  "node_modules/",
  "release-assets/",
  "apps/desktop/dist/",
  "apps/desktop/src-tauri/gen/",
  "apps/desktop/src-tauri/target/",
];

/** The command without heredoc bodies and quoted text, which are data, not commands. */
function commandWords(command: string): string {
  return command
    .replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2\s*(?=\n|$)/g, "")
    .replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, '""');
}

/** The subcommand and its arguments of each git invocation in a (possibly chained) command. */
function gitInvocations(command: string): { sub: string; args: string[] }[] {
  const invocations: { sub: string; args: string[] }[] = [];
  for (const segment of commandWords(command).split(/[;&|\n]+/)) {
    const words = segment.trim().split(/\s+/);
    let i = words.indexOf("git");
    if (i < 0) continue;
    i++;
    while (words[i]?.startsWith("-")) i += GIT_OPTIONS_WITH_VALUE.has(words[i] ?? "") ? 2 : 1;
    invocations.push({ sub: words[i] ?? "", args: words.slice(i + 1) });
  }
  return invocations;
}

/** A cluster of short options (`-vA`) that includes one of `letters`. */
function hasShortFlag(arg: string, letters: string): boolean {
  return /^-[a-zA-Z]+$/.test(arg) && [...arg.slice(1)].some((letter) => letters.includes(letter));
}

/** Why a shell command is blocked (docs/TDD.md: stage by explicit path), or null. */
export function commandViolation(command: string): string | null {
  for (const { sub, args } of gitInvocations(command)) {
    if (sub === "add") {
      const wide = args.find(
        (a) => [".", "*", ":/", "--all", "--update"].includes(a) || hasShortFlag(a, "Au"),
      );
      if (wide) {
        return `git add ${wide} is blocked: stage files by explicit path and check git status --short first (docs/TDD.md).`;
      }
    }
    if (sub === "commit") {
      const all = args.find((a) => a === "--all" || hasShortFlag(a, "a"));
      if (all) {
        return `git commit ${all} is blocked: stage files by explicit path with git add <files> (docs/TDD.md).`;
      }
    }
  }
  return null;
}

/** Why editing a file is blocked because a tool writes it, or null. `relPath` is from its checkout. */
export function generatedViolation(relPath: string): string | null {
  const rel = relPath.replaceAll("\\", "/");
  const hit = GENERATED.find((g) => (g.endsWith("/") ? rel.startsWith(g) : rel === g));
  if (!hit) return null;
  return `${rel} is generated (${hit}): change its source or rerun the tool that writes it (bun install, the build, bun test).`;
}

const norm = (path: string) => resolve(path).replaceAll("\\", "/").toLowerCase();

/** The shared `.git` directory of the checkout at `dir`, or null if `dir` is not a checkout. */
function commonGitDir(dir: string): string | null {
  const dotGit = join(dir, ".git");
  if (!existsSync(dotGit)) return null;
  if (statSync(dotGit).isDirectory()) return norm(dotGit);
  const gitDir = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, "utf8"))?.[1];
  // A linked worktree's gitdir is <common .git>/worktrees/<name>.
  return gitDir ? norm(resolve(dir, gitDir.trim(), "..", "..")) : null;
}

/**
 * The checkout a file belongs to: the main checkout or any linked worktree of the same
 * repository as `projectDir` (sessions run from the main checkout and edit the worktrees beside
 * it). Null for files outside every checkout of this repository.
 */
export function checkoutRoot(filePath: string, projectDir: string): string | null {
  const project = commonGitDir(projectDir);
  if (!project) return null;
  let dir = dirname(isAbsolute(filePath) ? filePath : resolve(projectDir, filePath));
  for (;;) {
    const common = commonGitDir(dir);
    if (common) return common === project ? dir : null;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
