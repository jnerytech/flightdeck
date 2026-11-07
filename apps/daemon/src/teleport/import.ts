/**
 * Issue #100, slice 2b: the target host turns a received package into a session of its own. The
 * manifest is trusted for nothing: the person names the repository (inside the allowed roots), the
 * base must be a commit that repository has (after a fetch of its own origin), and the bundle must
 * verify against it and carry the head the manifest names. The code lands in a new worktree of that
 * repository, the transcript next to the other transcripts of that worktree (never over one this
 * host has), and the session resumes there. A failure leaves no worktree, branch or transcript.
 * A session this host already has comes back only with more turns than its copy here, which is set
 * aside, never deleted (#870, docs/decisions/2026-11-07-teleport-return.md).
 */
import { constants } from "node:fs";
import {
  access,
  copyFile,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { join } from "node:path";
import type { PermissionMode, SessionStatus } from "@flightdeck/protocol";
import { refArg } from "../board/ref-arg.ts";
import { addWorktree } from "../board/worktree.ts";
import { FlightdeckError } from "../errors.ts";
import { resolveAllowedCwd } from "../paths.ts";
import { git, must } from "./git.ts";
import type { TeleportReceived } from "./receive.ts";

/** A received package taken out of the inbox for the import: nothing else removes it meanwhile. */
export interface TeleportClaim extends TeleportReceived {
  /** The package's folder goes. */
  release(): Promise<void>;
}

export interface TeleportImportDeps {
  inbox: {
    /** The package, checked, still in the inbox: a refusal leaves it there to try again. */
    received(id: string): Promise<TeleportReceived>;
    claim(id: string): Promise<TeleportClaim>;
  };
  allowedRoots: readonly string[];
  /** Where Claude Code keeps its transcripts on this host (`~/.claude/projects`). */
  historyRoot: string;
  /** The transcript of that Claude session this host already has, or null. */
  transcriptOf(claudeSessionId: string): string | null | Promise<string | null>;
  /** This host's managed records of that Claude session: a resume can leave more than one (#870). */
  sessionsOf(claudeSessionId: string): { id: string; status: SessionStatus }[];
  /** Ends this host's old record of a session that came back with more turns (#870). */
  close(sessionId: string): Promise<void>;
  /** Shows the session again: its copy here may have been archived when it left (#870). */
  unarchive(claudeSessionId: string): void;
  /** The time a set-aside transcript is named after. */
  now(): Date;
  /** Puts the transcript in place (`fs.copyFile`); a test makes it fail halfway. */
  copyFile?: typeof copyFile;
  resume(opts: {
    cwd: string;
    claudeSessionId: string;
    name: string | null;
    permissionMode: PermissionMode;
  }): Promise<{ sessionId: string }>;
}

export interface TeleportImported {
  sessionId: string;
  worktree: string;
  branch: string;
}

const ID = /^[A-Za-z0-9-]{1,64}$/;
/** The bundle's objects are checked as they come in: they land in the repository's own store. */
const FSCK = ["-c", "transfer.fsckObjects=true", "-c", "fetch.fsckObjects=true"];
/**
 * The bundle's files are written without LFS: its smudge filter would fetch from a server the
 * bundle's own files name. The person runs `git lfs pull` in the worktree if they want them.
 */
const NO_LFS = [
  "-c",
  "filter.lfs.smudge=",
  "-c",
  "filter.lfs.process=",
  "-c",
  "filter.lfs.required=false",
];
const SKIP_LFS = { GIT_LFS_SKIP_SMUDGE: "1" };
/** A fetch never waits on a password prompt: it fails instead. */
const NO_PROMPT = { GIT_TERMINAL_PROMPT: "0" };

const refuse = (code: "invalid_state" | "bad_request", reason: string) =>
  new FlightdeckError(code, reason.replaceAll("_", " "), reason);

/** The folder of a cwd's transcripts, the way Claude Code names it. */
const projectSlug = (cwd: string) => cwd.replace(/[^A-Za-z0-9]/g, "-");

export async function importPackage(
  deps: TeleportImportDeps,
  id: string,
  repo: string,
): Promise<TeleportImported> {
  // Every check runs on the package still in the inbox: a wrong repository can be fixed and
  // tried again without the source sending it anew.
  const target = await check(deps, await deps.inbox.received(id), repo);
  // Past the checks the import is final: a failure (Claude would not start, a full disk) takes
  // the package with it, and the source sends it again. Nothing half-made stays on either side.
  const claim = await deps.inbox.claim(id);
  try {
    return await land(deps, claim, target);
  } finally {
    await claim.release();
  }
}

/** The repository the person picked, if it can take this package: its top and the base. */
async function check(
  deps: TeleportImportDeps,
  received: TeleportReceived,
  repo: string,
): Promise<Target> {
  const { manifest } = received;
  const code = manifest.git;
  // The ref is the one the source makes for this package: never a ref the manifest picks.
  if (
    !code ||
    !received.code ||
    !ID.test(manifest.id) ||
    code.ref !== `refs/flightdeck/teleport/${manifest.id}`
  ) {
    throw refuse("bad_request", "request_invalid");
  }
  const cwd = await resolveAllowedCwd(repo, deps.allowedRoots);
  // #870: a copy here is replaced only when the session came back with more turns (every byte of
  // this host's copy is in the incoming one) and nothing here is working on it.
  const here = await deps.transcriptOf(manifest.claudeSessionId);
  const mine = here ? deps.sessionsOf(manifest.claudeSessionId) : [];
  if (here && (!mine.every(idle) || !(await isPrefix(here, received.transcript))))
    throw refuse("invalid_state", "teleport_exists");
  const found = await git(cwd, ["rev-parse", "--show-toplevel"]);
  if (!found) throw refuse("invalid_state", "teleport_no_git");
  // The worktree, its branch and the exclude line go in the repository itself: it is in the roots too.
  const top = await resolveAllowedCwd(found, deps.allowedRoots);
  // The same project: the base is a commit of this repository (fetched from its own origin when
  // it is not there yet, with no prompt), and the bundle verifies.
  const base = refArg(code.baseSha);
  // git-arg: base is the manifest's sha through refArg
  const has = () => git(top, ["rev-parse", "--verify", "--quiet", `${base}^{commit}`]);
  let known = await has();
  if (!known) {
    await git(top, ["fetch", "--quiet", "--no-recurse-submodules", "origin"], NO_PROMPT);
    known = await has();
  }
  const verified = await git(top, ["bundle", "verify", "--quiet", received.code]);
  if (!known || verified === null) {
    throw refuse("invalid_state", "teleport_no_project");
  }
  return { top, base, here, mine: mine.map((session) => session.id) };
}

/** The repository that takes the package, and this host's copy of the session it replaces. */
interface Target {
  top: string;
  base: string;
  here: string | null;
  mine: string[];
}

/** A record that is not working on its transcript: idle or ended. */
const idle = (session: { status: SessionStatus }) =>
  session.status === "idle" || session.status === "ended";

const CHUNK = 64 * 1024;

/** Whether every byte of `local` is the first bytes of `incoming`; false when either is unreadable. */
export async function isPrefix(local: string, incoming: string): Promise<boolean> {
  // A link is never this host's copy: it would move the link and compare what it points to.
  const sizes = await Promise.all([lstat(local), stat(incoming)]).catch(() => null);
  if (!sizes) return false;
  const [a, b] = sizes;
  if (!a.isFile() || !b.isFile() || a.size > b.size) return false;
  const x = await open(local, "r");
  try {
    const y = await open(incoming, "r");
    try {
      const left = Buffer.alloc(CHUNK);
      const right = Buffer.alloc(CHUNK);
      for (let at = 0; at < a.size; at += CHUNK) {
        const n = Math.min(CHUNK, a.size - at);
        const [r1, r2] = await Promise.all([x.read(left, 0, n, at), y.read(right, 0, n, at)]);
        // A file that shrank while it was read is not the same copy.
        if (r1.bytesRead !== n || r2.bytesRead !== n) return false;
        if (!left.subarray(0, n).equals(right.subarray(0, n))) return false;
      }
      return true;
    } finally {
      await y.close();
    }
  } finally {
    await x.close();
  }
}

async function land(
  deps: TeleportImportDeps,
  claim: TeleportClaim,
  { top, base, here, mine }: Target,
): Promise<TeleportImported> {
  const { manifest } = claim;
  // Checked before the claim: the claim reads the same package.
  const code = manifest.git as NonNullable<typeof manifest.git>;
  const worktree = await addWorktree(top, `teleport ${code.branch ?? manifest.id}`, base);
  try {
    const path = await realpath(worktree.path);
    await restore(path, claim.code as string, code.ref, code.head, manifest.id);
    const started = await replacing(deps, claim, here, mine, () => start(deps, claim, path));
    return { ...started, worktree: path, branch: worktree.branch };
  } catch (error) {
    await git(top, ["worktree", "remove", "--force", worktree.path]);
    await git(top, ["branch", "-D", refArg(worktree.branch)]);
    throw error;
  }
}

/** HEAD at the source's HEAD, the files as the source's working tree had them, unstaged. */
async function restore(
  path: string,
  bundle: string,
  ref: string,
  head: string,
  id: string,
): Promise<void> {
  const into = `refs/flightdeck/teleport-in/${id}`;
  // git-arg: ref is refs/flightdeck/teleport/<id> (checked against ID), into is made here
  await must(path, [
    ...FSCK,
    "fetch",
    "--quiet",
    "--no-recurse-submodules",
    bundle,
    `${ref}:${into}`,
  ]);
  try {
    const parent = await must(path, ["rev-parse", "--verify", `${into}^`]);
    if (parent !== head) throw refuse("bad_request", "request_invalid");
    await must(
      path,
      [...NO_LFS, "reset", "--quiet", "--hard", "--no-recurse-submodules", parent],
      SKIP_LFS,
    );
    // git-arg: into is made here, from a package id checked against ID
    await must(path, [...NO_LFS, "read-tree", "-u", "--reset", into], SKIP_LFS);
    await must(path, ["reset", "--quiet", parent]);
  } finally {
    // git-arg: into is made here, from a package id checked against ID
    await git(path, ["update-ref", "-d", into]);
  }
}

/**
 * #870: this host's copy of a session that came back is set aside while the session starts: renamed
 * to `<id>.jsonl.replaced-<utc>` in its own folder, never deleted. A copy that grew since the checks
 * is put back and the import refused; a start that fails puts it back too. Putting it back never
 * writes over a file: if one appeared meanwhile, the copy stays set aside.
 */
async function replacing<T>(
  deps: TeleportImportDeps,
  claim: TeleportClaim,
  here: string | null,
  mine: string[],
  run: () => Promise<T>,
): Promise<T> {
  if (!here) return run();
  // Every record of it here ends first: none writes into the copy while it is set aside. One that
  // will not end stops the return before the copy is touched.
  for (const id of mine) {
    await deps.close(id).catch(() => {
      throw refuse("invalid_state", "teleport_exists");
    });
  }
  const aside = `${here}.replaced-${deps.now().toISOString().replace(/[:.]/g, "-")}`;
  await rename(here, aside);
  let started: T;
  try {
    if (!(await isPrefix(aside, claim.transcript)))
      throw refuse("invalid_state", "teleport_exists");
    started = await run();
  } catch (error) {
    await copyFile(aside, here, constants.COPYFILE_EXCL).then(
      () => rm(aside, { force: true }),
      () => {},
    );
    throw error;
  }
  // The session shows again (R2 archives it where it leaves from); a failure here never undoes a
  // session that started.
  try {
    deps.unarchive(claim.manifest.claudeSessionId);
  } catch {
    // It stays archived: the person finds it among the archived sessions.
  }
  return started;
}

/** The transcript next to the worktree's, then the session; the transcript goes if it fails. */
async function start(
  deps: TeleportImportDeps,
  claim: TeleportClaim,
  path: string,
): Promise<{ sessionId: string }> {
  const { manifest } = claim;
  const folder = join(deps.historyRoot, projectSlug(path));
  // The first folder made here, if any: a failed start takes it with the transcript.
  const made = await mkdir(folder, { recursive: true, mode: 0o700 });
  const file = join(folder, `${manifest.claudeSessionId}.jsonl`);
  // Never over a transcript this host has; any other failure (a full disk) is itself.
  const exists = (error: unknown) => (error as { code?: string }).code === "EEXIST";
  // A file already there is the host's: a failure on the package's side must leave it alone.
  const there = await lstat(file).then(
    () => true,
    () => false,
  );
  await (deps.copyFile ?? copyFile)(claim.transcript, file, constants.COPYFILE_EXCL).catch(
    async (error) => {
      if (made) await rm(made, { recursive: true, force: true });
      // A copy that stopped halfway left this file, unless the host had it before.
      else if (!there) await rm(file, { force: true });
      throw exists(error) ? refuse("invalid_state", "teleport_exists") : error;
    },
  );
  try {
    return await deps.resume({
      cwd: path,
      claudeSessionId: manifest.claudeSessionId,
      name: null,
      // A package from another host asks no less here than the default: only plan, which asks
      // more, comes along.
      permissionMode: manifest.permissionMode === "plan" ? "plan" : "default",
    });
  } catch (error) {
    await rm(made ?? file, { recursive: true, force: true });
    throw error;
  }
}

/** The daemon's parts an import reads (issue #100). */
export interface TeleportImportWiring {
  inbox: TeleportImportDeps["inbox"];
  allowedRoots: readonly string[];
  historyRoots: readonly string[];
  indexer: { transcriptFile(claudeSessionId: string): string | null } | undefined;
  manager: {
    createResumed: TeleportImportDeps["resume"];
    list(): { id: string; claudeSessionId: string | null; status: SessionStatus }[];
    close(sessionId: string): Promise<void>;
  };
  meta: { set(claudeSessionId: string, patch: { archived: boolean }): unknown } | undefined;
}

/** The transcript of a session in any project folder of the history roots, or null. */
async function onDisk(roots: readonly string[], claudeSessionId: string): Promise<string | null> {
  // A session id is a UUID: a name with a separator or a dot never reaches the path.
  if (!/^[0-9a-f-]{36}$/i.test(claudeSessionId)) return null;
  for (const root of roots) {
    // A root that is not there (yet) holds no transcript.
    const folders = await readdir(root, { withFileTypes: true }).catch(() => []);
    for (const folder of folders) {
      if (!folder.isDirectory()) continue;
      const file = join(root, folder.name, `${claudeSessionId}.jsonl`);
      if (
        await access(file).then(
          () => true,
          () => false,
        )
      )
        return file;
    }
  }
  return null;
}

/** The real deps of an import. */
export function teleportImportDeps(wiring: TeleportImportWiring): TeleportImportDeps | undefined {
  // No place for the transcript on this host: no import (never a folder relative to the daemon).
  const historyRoot = wiring.historyRoots[0];
  if (!historyRoot) return undefined;
  return {
    inbox: wiring.inbox,
    // The same array the daemon keeps: a root added later counts at once.
    allowedRoots: wiring.allowedRoots,
    // Where Claude Code writes on this host: the first history root (`~/.claude/projects`).
    historyRoot,
    // The indexer scans every 10 s or more: a session created moments ago is on disk before it is
    // in the index, so the history folders are read too (#715).
    transcriptOf: async (claudeSessionId) =>
      wiring.indexer?.transcriptFile(claudeSessionId) ??
      (await onDisk(wiring.historyRoots, claudeSessionId)),
    resume: (opts) => wiring.manager.createResumed(opts),
    sessionsOf: (claudeSessionId) =>
      wiring.manager
        .list()
        .filter((s) => s.claudeSessionId === claudeSessionId)
        .map((s) => ({ id: s.id, status: s.status })),
    close: (sessionId) => wiring.manager.close(sessionId),
    unarchive: (claudeSessionId) => {
      wiring.meta?.set(claudeSessionId, { archived: false });
    },
    now: () => new Date(),
  };
}
