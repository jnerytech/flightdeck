/**
 * Issue #100, slice 2b: the target host turns a received package into a session of its own. The
 * manifest is trusted for nothing: the person names the repository (inside the allowed roots), the
 * base must be a commit that repository has (after a fetch of its own origin), and the bundle must
 * verify against it and carry the head the manifest names. The code lands in a new worktree of that
 * repository, the transcript next to the other transcripts of that worktree (never over one this
 * host has), and the session resumes there. A failure leaves no worktree, branch or transcript.
 */
import { constants } from "node:fs";
import { access, copyFile, mkdir, readdir, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import type { PermissionMode } from "@flightdeck/protocol";
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
): Promise<{ top: string; base: string }> {
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
  if (await deps.transcriptOf(manifest.claudeSessionId))
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
  return { top, base };
}

async function land(
  deps: TeleportImportDeps,
  claim: TeleportClaim,
  { top, base }: { top: string; base: string },
): Promise<TeleportImported> {
  const { manifest } = claim;
  // Checked before the claim: the claim reads the same package.
  const code = manifest.git as NonNullable<typeof manifest.git>;
  const worktree = await addWorktree(top, `teleport ${code.branch ?? manifest.id}`, base);
  try {
    const path = await realpath(worktree.path);
    await restore(path, claim.code as string, code.ref, code.head, manifest.id);
    return { ...(await start(deps, claim, path)), worktree: path, branch: worktree.branch };
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
  await copyFile(claim.transcript, file, constants.COPYFILE_EXCL).catch(async (error) => {
    if (made) await rm(made, { recursive: true, force: true });
    throw (error as { code?: string }).code === "EEXIST"
      ? refuse("invalid_state", "teleport_exists")
      : error;
  });
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
  manager: { createResumed: TeleportImportDeps["resume"] };
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
  };
}
