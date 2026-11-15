import { readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SessionStatus, TeleportManifest } from "@flightdeck/protocol";
import { bundleCode } from "../../src/teleport/bundle.ts";
import type { TeleportClaim, TeleportImportDeps } from "../../src/teleport/import.ts";
import { git, gitRepoWithOrigin } from "../support/board-helpers.ts";
import { tempDir } from "../support/helpers.ts";

/**
 * Issue #100, slice 2b: the target turns a received package into a session of its own. The code
 * lands in a new worktree of the repository the person names, which must be the same project (the
 * base is a commit of its origin); the transcript goes next to that worktree's transcripts, never
 * over one this host has; the session resumes there. A failure leaves nothing behind.
 */
export const ID = "0b6f5c2e-6f0a-4c39-9a51-7c4f1d2e3a4b";
export const onWindows = process.platform === "win32";
export const TRANSCRIPT = '{"type":"user","message":{"content":"fix the login"}}\n';

const sha256 = (bytes: Buffer | string) =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");

export const reason = (run: () => Promise<unknown>) =>
  run().then(
    () => "no refusal",
    (error: { reason?: string }) => error.reason ?? String(error),
  );

/** The source: a branch two commits past origin, a changed file and a new one; its package. */
export async function packaged(
  over: Partial<TeleportManifest> = {},
  options: { lfs?: boolean } = {},
) {
  const { repo, remote, root } = gitRepoWithOrigin();
  git(repo, "checkout", "-q", "-b", "feature");
  await writeFile(join(repo, "f1.txt"), "1\n");
  git(repo, "add", "f1.txt");
  git(repo, "commit", "-q", "-m", "feat(x): one");
  await writeFile(join(repo, "f1.txt"), "1 changed\n");
  await writeFile(join(repo, "new.txt"), "new\n");
  // A file the tree says is LFS's: the target's smudge filter would fetch it.
  if (options.lfs) {
    await writeFile(join(repo, ".gitattributes"), "*.bin filter=lfs\n");
    await writeFile(join(repo, "data.bin"), "version https://git-lfs.github.com/spec/v1\n");
  }
  const folder = tempDir("fd-teleport-pkg-");
  const code = await bundleCode({ cwd: repo, folder, id: "pkg-1", scan: () => [] });
  const transcript = join(folder, "transcript");
  await writeFile(transcript, TRANSCRIPT);
  const manifest: TeleportManifest = {
    id: "pkg-1",
    sessionId: "s1",
    claudeSessionId: ID,
    cwd: repo,
    model: null,
    permissionMode: "bypassPermissions",
    persona: null,
    expiresAt: "2026-11-06T12:30:00.000Z",
    parts: [
      { name: "transcript", size: TRANSCRIPT.length, sha256: sha256(TRANSCRIPT) },
      { name: "code", size: code.size, sha256: code.sha256 },
    ],
    secrets: { lines: 0, labels: [] },
    git: {
      branch: code.branch,
      head: code.head,
      base: code.base,
      baseSha: code.baseSha,
      ref: code.ref,
      ahead: code.ahead,
      changed: code.changed,
    },
    ...over,
  };
  return { manifest, transcript, code: code.file, remote, root, source: repo };
}

/** The target: its own clone of origin, under its allowed root, and the fakes around the import. */
export function target(
  pkg: Awaited<ReturnType<typeof packaged>>,
  options: {
    local?: string | null;
    failResume?: boolean;
    /** This host's managed records of the session: a resume can leave more than one. */
    mine?: { id: string; status: SessionStatus }[];
    /** What happens on this host while the session starts, before it answers. */
    whileStarting?: () => Promise<void>;
    failClose?: boolean;
    failUnarchive?: boolean;
    autocrlf?: boolean;
  } = {},
) {
  const roots = tempDir("fd-teleport-target-");
  const repo = join(roots, "app");
  git(roots, "clone", "-q", pkg.remote, repo);
  // The import runs git with the repository's own config, and the test's git() with autocrlf off:
  // pinned here, both read the files the same way on every OS (Git for Windows defaults to true).
  git(repo, "config", "core.autocrlf", String(options.autocrlf ?? false));
  const history = tempDir("fd-teleport-history-");
  const calls = {
    released: 0,
    resumed: [] as unknown[],
    closed: [] as string[],
    /** The records already closed when the session was asked to start. */
    closedAtResume: null as string[] | null,
    unarchived: [] as string[],
  };
  const claim: TeleportClaim = {
    manifest: pkg.manifest,
    transcript: pkg.transcript,
    code: pkg.code,
    release: async () => {
      calls.released++;
    },
  };
  const deps: TeleportImportDeps = {
    inbox: holding(claim),
    allowedRoots: [roots],
    historyRoot: history,
    transcriptOf: () => options.local ?? null,
    resume: async (opts) => {
      calls.resumed.push(opts);
      calls.closedAtResume = [...calls.closed];
      await options.whileStarting?.();
      if (options.failResume) throw new Error("claude would not start");
      return { sessionId: "t1" };
    },
    sessionsOf: () => options.mine ?? [],
    close: async (sessionId) => {
      calls.closed.push(sessionId);
      if (options.failClose) throw new Error("the old record would not end");
    },
    unarchive: (claudeSessionId) => {
      calls.unarchived.push(claudeSessionId);
      if (options.failUnarchive) throw new Error("the database is locked");
    },
    now: () => new Date("2026-11-07T12:00:00.000Z"),
  };
  return { repo, roots, history, deps, calls };
}

/** Where Claude Code keeps the transcripts of a folder. */
export const slug = (path: string) => path.replace(/[^A-Za-z0-9]/g, "-");

/** An inbox that holds one package: read it to check, claim it to import. */
export const holding = (claim: TeleportClaim) => ({
  received: async () => claim,
  claim: async () => claim,
});

export const leftovers = (repo: string, history: string) =>
  Promise.all([
    git(repo, "worktree", "list", "--porcelain")
      .split("\n")
      .filter((l) => l.startsWith("worktree ")).length,
    git(repo, "branch", "--list", "fd/*").trim(),
    git(repo, "for-each-ref", "refs/flightdeck").trim(),
    readdir(history).catch(() => []),
  ]);
