/**
 * Issue #797: a repository searched by name or by content, for the context panel. The daemon runs
 * `git ls-files`, `rg` or `git grep` itself: an argument list, never a shell, with the person's text
 * as one fixed string after `--` or `-e`. What comes back is capped in matches, bytes and time, and a
 * match whose path leaves the repository, or the content of a credential, never leaves the host.
 */
import { realpath } from "node:fs/promises";
import { join, relative } from "node:path";
import {
  type FileSearchMatch,
  type FileSearchPayload,
  type FileSearchResult,
  SecretScanner,
} from "@flightdeck/protocol";
import { type CommandResult, gitLimitedFor, runLimited } from "../board/command.ts";
import { FlightdeckError } from "../errors.ts";
import { isInside } from "../paths.ts";
import { credential } from "../permissions/sensitive-paths.ts";
import { whichOnPath } from "../which.ts";
import { firstStep, isGitDir } from "./paths.ts";

export interface SearchOptions {
  /** Where `rg` is, or `null` to search with `git grep`; looked up on the PATH when absent. */
  rg?: () => string | null;
  /** Past it the program is killed and the result says `truncated`; 5 s when absent. */
  timeoutMs?: number;
  /** The most output read from the program; 4 MiB when absent. */
  maxBytes?: number;
  /** Runs `rg`: the capped runner when absent (a test answers for it). */
  run?: typeof runLimited;
}

type Search = Omit<FileSearchPayload, "target">;

/** What a program found, before the checks: paths relative to the repository, with `/`. */
interface Found {
  matches: FileSearchMatch[];
  truncated: boolean;
}

const DEFAULT_LIMIT = 100;
const TIMEOUT_MS = 5_000;
const MAX_BYTES = 4 * 1024 * 1024;
/** A line is cut to this many characters (code points, never half of one). */
const TEXT_MAX = 200;
/** At most this many lines of one file. */
const PER_FILE_LINES = 5;
const PER_FILE = String(PER_FILE_LINES);
/** Git runs no fsmonitor hook and writes paths as they are. */
const GIT_SAFE = ["-c", "core.fsmonitor=false", "-c", "core.quotePath=false"];
const NUL = 0;

/** `rg` on the current PATH, or `null`: then `git grep` searches. */
export function findRg(): string | null {
  return whichOnPath("rg");
}

/** Token shapes and private keys; the vault's values are the app's to mask (it has them). */
const scanner = new SecretScanner();

/** What is read past the cut before the mask: a token across the cut is masked whole (#829). */
const MASK_WINDOW = 1024;

/**
 * A matched line as it leaves the host: secrets masked, then cut to 200 characters. Masked before
 * the cut, so a token the cut would split is still seen whole and masked whole.
 */
const clip = (text: string) =>
  Array.from(
    scanner.redact(
      Array.from(text.replace(/\r?\n$/, ""))
        .slice(0, TEXT_MAX + MASK_WINDOW)
        .join(""),
      false,
    ),
  )
    .slice(0, TEXT_MAX)
    .join("");

const cut = (result: CommandResult & { truncated: boolean }) =>
  result.truncated || result.timedOut === true;

function notRepository(root: string): FlightdeckError {
  return new FlightdeckError(
    "invalid_state",
    `${root} is not in a git repository`,
    "repo_not_git",
    { path: root },
  );
}

/**
 * A program that failed for another reason than "nothing found", with nothing to show. Its exit
 * code only: what it wrote may quote the repository's lines.
 */
function failed(program: string, code: number): FlightdeckError {
  return new FlightdeckError("internal", `${program} failed (exit ${code})`, "command_failed", {
    what: program,
    output: `exit ${code}`,
  });
}

export async function searchRepository(
  root: string,
  input: Search,
  opts: SearchOptions = {},
): Promise<FileSearchResult> {
  const realRoot = await realpath(root);
  // A repository only, whatever the mode: rg would search any folder, the home's included.
  const top = await gitLimitedFor(
    realRoot,
    64 * 1024,
    // git-arg: fixed options only
    [...GIT_SAFE, "rev-parse", "--show-toplevel"],
    opts.timeoutMs ?? TIMEOUT_MS,
  );
  if (top.code !== 0) throw notRepository(root);
  const found =
    input.mode === "name"
      ? await byName(realRoot, input.query, opts)
      : await byContent(realRoot, input.query, opts);
  const limit = input.limit ?? DEFAULT_LIMIT;
  const stays = new Map<string, string | null>();
  const matches: FileSearchMatch[] = [];
  let more = false;
  for (const match of found.matches) {
    // A path that holds a secret is left out: masked, it would name no file to open (#829).
    if (scanner.scan(match.path).length > 0) continue;
    const real = await inside(realRoot, match.path, stays);
    if (real === null) continue;
    // A credential's lines never leave the host; its name may, marked. A link counts by what it is.
    const secret = credential(match.path) || credential(real);
    if (input.mode === "content" && secret) continue;
    if (matches.length === limit) {
      more = true;
      break;
    }
    matches.push(secret ? { ...match, secret } : match);
  }
  return { mode: input.mode, query: input.query, matches, truncated: found.truncated || more };
}

/**
 * The path, links followed, relative to the repository: `null` outside it or in its `.git`. Asked
 * once per path.
 */
async function inside(realRoot: string, path: string, seen: Map<string, string | null>) {
  const known = seen.get(path);
  if (known !== undefined) return known;
  const real = await realpath(join(realRoot, path)).catch(() => null);
  const rel = real === null ? null : relative(realRoot, real);
  const ok = real !== null && rel !== null && isInside(realRoot, real) && !isGitDir(firstStep(rel));
  seen.set(path, ok ? rel : null);
  return ok ? rel : null;
}

/** Tracked and new files, `.gitignore` kept, whose path holds the text, case aside. */
async function byName(root: string, query: string, opts: SearchOptions): Promise<Found> {
  const result = await gitLimitedFor(
    root,
    opts.maxBytes ?? MAX_BYTES,
    // git-arg: fixed options only; the person's text is never an argument here
    [...GIT_SAFE, "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    opts.timeoutMs ?? TIMEOUT_MS,
    undefined,
    NUL,
  );
  if (result.code !== 0 && !cut(result)) throw notRepository(root);
  const wanted = query.toLowerCase();
  // A path in conflict is listed once per stage.
  const paths = new Set(result.stdout.split("\0").filter(Boolean));
  return {
    matches: [...paths].filter((p) => p.toLowerCase().includes(wanted)).map((path) => ({ path })),
    truncated: cut(result),
  };
}

async function byContent(root: string, query: string, opts: SearchOptions): Promise<Found> {
  const rg = (opts.rg ?? findRg)();
  return rg ? await withRg(rg, root, query, opts) : await withGitGrep(root, query, opts);
}

/** One match of `rg --json`; a path or a line that is not UTF-8 comes as `bytes`, and is skipped. */
interface RgMatch {
  type: string;
  data?: { path?: { text?: string }; lines?: { text?: string }; line_number?: number };
}

async function withRg(rg: string, root: string, query: string, opts: SearchOptions) {
  // `--no-config`: a config file named in the environment could add `--pre` (a program to run).
  const result = await (opts.run ?? runLimited)(
    [
      rg,
      "--no-config",
      "--json",
      "--fixed-strings",
      "--ignore-case",
      "--max-count",
      PER_FILE,
      "--max-filesize",
      "1M",
      "--",
      query,
      ".",
    ],
    root,
    opts.maxBytes ?? MAX_BYTES,
    opts.timeoutMs ?? TIMEOUT_MS,
  );
  const matches: FileSearchMatch[] = [];
  for (const line of result.stdout.split("\n")) {
    let event: RgMatch;
    try {
      event = JSON.parse(line) as RgMatch;
    } catch {
      continue;
    }
    const path = event.data?.path?.text;
    const text = event.data?.lines?.text;
    const number = event.data?.line_number;
    if (event.type !== "match" || path === undefined || text === undefined || !number) continue;
    // Windows writes `.\\src\\a.ts`; elsewhere a backslash is part of a name.
    const named = process.platform === "win32" ? path.replaceAll("\\", "/") : path;
    matches.push({
      path: named.replace(/^\.\//, ""),
      line: number,
      text: clip(text),
    });
  }
  // 1 is "nothing found"; 2 with matches is a file it could not read on the way.
  if (result.code > 1 && matches.length === 0 && !cut(result)) throw failed("rg", result.code);
  return { matches, truncated: cut(result) };
}

async function withGitGrep(root: string, query: string, opts: SearchOptions): Promise<Found> {
  const result = await gitLimitedFor(
    root,
    opts.maxBytes ?? MAX_BYTES,
    // git-arg: the person's text is the pattern after -e, a fixed string (-F)
    [
      ...GIT_SAFE,
      "grep",
      "-z",
      "-n",
      "-I",
      "-i",
      "-F",
      "--untracked",
      // No --max-count: older gits (before 2.38) refuse it. The lines of a file are capped below.
      "-e",
      query,
    ],
    opts.timeoutMs ?? TIMEOUT_MS,
  );
  if (result.code > 1 && !cut(result)) throw failed("git grep", result.code);
  const matches: FileSearchMatch[] = [];
  const perFile = new Map<string, number>();
  for (const line of result.stdout.split("\n")) {
    // `path NUL line NUL text`: the text may hold a NUL of its own.
    const [path, number, ...rest] = line.split("\0");
    if (!path || !number || rest.length === 0) continue;
    const count = (perFile.get(path) ?? 0) + 1;
    perFile.set(path, count);
    if (count > PER_FILE_LINES) continue;
    matches.push({ path, line: Number(number), text: clip(rest.join("\0")) });
  }
  return { matches, truncated: cut(result) };
}
