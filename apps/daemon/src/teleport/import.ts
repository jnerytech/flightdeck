/**
 * Issue #100, slice 2b: the target host turns a received package into a session of its own. The
 * manifest is trusted for nothing: the person names the repository (inside the allowed roots), the
 * base must be a commit that repository has (after a fetch of its own origin), and the bundle must
 * verify against it and carry the head the manifest names. The code lands in a new worktree of that
 * repository, the transcript next to the other transcripts of that worktree (never over one this
 * host has), and the session resumes there. A failure leaves no worktree, branch or transcript.
 */
import { constants } from "node:fs";
import { copyFile, mkdir, realpath, rm } from "node:fs/promises";
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
  inbox: { claim(id: string): Promise<TeleportClaim> };
  allowedRoots: readonly string[];
  /** Where Claude Code keeps its transcripts on this host (`~/.claude/projects`). */
  historyRoot: string;
  /** The transcript of that Claude session this host already has, or null. */
  transcriptOf(claudeSessionId: string): string | null;
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

const refuse = (code: "invalid_state" | "bad_request", reason: string) =>
  new FlightdeckError(code, reason.replaceAll("_", " "), reason);

/** The folder of a cwd's transcripts, the way Claude Code names it. */
const projectSlug = (cwd: string) => cwd.replace(/[^A-Za-z0-9]/g, "-");

export async function importPackage(
  deps: TeleportImportDeps,
  id: string,
  repo: string,
): Promise<TeleportImported> {
  const claim = await deps.inbox.claim(id);
  try {
    return await land(deps, claim, repo);
  } finally {
    await claim.release();
  }
}

async function land(
  deps: TeleportImportDeps,
  claim: TeleportClaim,
  repo: string,
): Promise<TeleportImported> {
  const { manifest } = claim;
  const code = manifest.git;
  // The ref is the one the source makes for this package: never a ref the manifest picks.
  if (
    !code ||
    !claim.code ||
    !ID.test(manifest.id) ||
    code.ref !== `refs/flightdeck/teleport/${manifest.id}`
  ) {
    throw refuse("bad_request", "request_invalid");
  }
  const cwd = await resolveAllowedCwd(repo, deps.allowedRoots);
  if (deps.transcriptOf(manifest.claudeSessionId)) throw refuse("invalid_state", "teleport_exists");
  const top = await git(cwd, ["rev-parse", "--show-toplevel"]);
  if (!top) throw refuse("invalid_state", "teleport_no_git");
  // The same project: the base is a commit of this repository's origin, and the bundle verifies.
  await git(top, ["fetch", "--quiet", "--no-recurse-submodules", "origin"]);
  const base = refArg(code.baseSha);
  // git-arg: base is the manifest's sha through refArg
  const known = await git(top, ["rev-parse", "--verify", "--quiet", `${base}^{commit}`]);
  const verified = await git(top, ["bundle", "verify", "--quiet", claim.code]);
  if (!known || verified === null) {
    throw refuse("invalid_state", "teleport_no_project");
  }
  const worktree = await addWorktree(top, `teleport ${code.branch ?? manifest.id}`, base);
  try {
    const path = await realpath(worktree.path);
    await restore(path, claim.code, code.ref, code.head, manifest.id);
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
  await must(path, ["fetch", "--quiet", "--no-recurse-submodules", bundle, `${ref}:${into}`]);
  try {
    const parent = await must(path, ["rev-parse", "--verify", `${into}^`]);
    if (parent !== head) throw refuse("bad_request", "request_invalid");
    await must(path, ["reset", "--quiet", "--hard", "--no-recurse-submodules", parent]);
    // git-arg: into is made here, from a package id checked against ID
    await must(path, ["read-tree", "-u", "--reset", into]);
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
  // Never over a transcript this host has.
  await copyFile(claim.transcript, file, constants.COPYFILE_EXCL).catch(() => {
    throw refuse("invalid_state", "teleport_exists");
  });
  try {
    return await deps.resume({
      cwd: path,
      claudeSessionId: manifest.claudeSessionId,
      name: null,
      // A package from another host does not skip this host's prompts.
      permissionMode:
        manifest.permissionMode === "bypassPermissions" ? "default" : manifest.permissionMode,
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

/** The real deps of an import. */
export function teleportImportDeps(wiring: TeleportImportWiring): TeleportImportDeps {
  return {
    inbox: wiring.inbox,
    // The same array the daemon keeps: a root added later counts at once.
    allowedRoots: wiring.allowedRoots,
    // Where Claude Code writes on this host: the first history root (`~/.claude/projects`).
    historyRoot: wiring.historyRoots[0] ?? "",
    transcriptOf: (claudeSessionId) => wiring.indexer?.transcriptFile(claudeSessionId) ?? null,
    resume: (opts) => wiring.manager.createResumed(opts),
  };
}
