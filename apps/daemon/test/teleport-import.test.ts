import { describe, expect, test } from "bun:test";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { TeleportManifest } from "@flightdeck/protocol";
import { bundleCode } from "../src/teleport/bundle.ts";
import {
  importPackage,
  type TeleportClaim,
  type TeleportImportDeps,
} from "../src/teleport/import.ts";
import { git, gitRepo, gitRepoWithOrigin } from "./board-helpers.ts";
import { tempDir } from "./helpers.ts";

/**
 * Issue #100, slice 2b: the target turns a received package into a session of its own. The code
 * lands in a new worktree of the repository the person names, which must be the same project (the
 * base is a commit of its origin); the transcript goes next to that worktree's transcripts, never
 * over one this host has; the session resumes there. A failure leaves nothing behind.
 */
const ID = "0b6f5c2e-6f0a-4c39-9a51-7c4f1d2e3a4b";
const TRANSCRIPT = '{"type":"user","message":{"content":"fix the login"}}\n';

const sha256 = (bytes: Buffer | string) =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");

const reason = (run: () => Promise<unknown>) =>
  run().then(
    () => "no refusal",
    (error: { reason?: string }) => error.reason ?? String(error),
  );

/** The source: a branch two commits past origin, a changed file and a new one; its package. */
async function packaged(over: Partial<TeleportManifest> = {}, options: { lfs?: boolean } = {}) {
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
function target(
  pkg: Awaited<ReturnType<typeof packaged>>,
  options: { local?: string | null; failResume?: boolean } = {},
) {
  const roots = tempDir("fd-teleport-target-");
  const repo = join(roots, "app");
  git(roots, "clone", "-q", pkg.remote, repo);
  const history = tempDir("fd-teleport-history-");
  const calls = { released: 0, resumed: [] as unknown[] };
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
      if (options.failResume) throw new Error("claude would not start");
      return { sessionId: "t1" };
    },
  };
  return { repo, roots, history, deps, calls };
}

/** Where Claude Code keeps the transcripts of a folder. */
const slug = (path: string) => path.replace(/[^A-Za-z0-9]/g, "-");

/** An inbox that holds one package: read it to check, claim it to import. */
const holding = (claim: TeleportClaim) => ({
  received: async () => claim,
  claim: async () => claim,
});

const leftovers = (repo: string, history: string) =>
  Promise.all([
    git(repo, "worktree", "list", "--porcelain")
      .split("\n")
      .filter((l) => l.startsWith("worktree ")).length,
    git(repo, "branch", "--list", "fd/*").trim(),
    git(repo, "for-each-ref", "refs/flightdeck").trim(),
    readdir(history).catch(() => []),
  ]);

describe("teleport-import: a received package becomes a session on this host (#100)", () => {
  test("the code lands in a new worktree as it was, the transcript next to it, and the session resumes there", async () => {
    const pkg = await packaged();
    const { repo, history, deps, calls } = target(pkg);
    const done = await importPackage(deps, "in-1", repo).catch((e: Error) => ({
      sessionId: String(e),
      worktree: "",
      branch: "",
    }));
    const at = <T>(cmd: () => T): T | string => {
      try {
        return cmd();
      } catch {
        return "no worktree";
      }
    };
    expect([
      done.sessionId,
      done.worktree.startsWith(join(repo, ".flightdeck", "worktrees")),
      at(() => git(done.worktree, "rev-parse", "HEAD").trim() === pkg.manifest.git?.head),
      await readFile(join(done.worktree, "f1.txt"), "utf8").catch(() => "missing"),
      await readFile(join(done.worktree, "new.txt"), "utf8").catch(() => "missing"),
      at(() => git(done.worktree, "status", "--porcelain").trim()),
      await readFile(join(history, slug(done.worktree), `${ID}.jsonl`), "utf8").catch(
        () => "missing",
      ),
      calls.resumed,
      calls.released,
      git(repo, "for-each-ref", "refs/flightdeck").trim(),
    ]).toEqual([
      "t1",
      true,
      true,
      "1 changed\n",
      "new\n",
      "M f1.txt\n?? new.txt",
      TRANSCRIPT,
      [{ cwd: done.worktree, claudeSessionId: ID, name: null, permissionMode: "default" }],
      1,
      "",
    ]);
  });

  test("a repository of another project, or outside the allowed roots, is refused and nothing is left", async () => {
    const pkg = await packaged();
    const { history, deps, calls, roots } = target(pkg);
    // Another project: a history of its own, with nothing in common with the package's.
    const other = join(roots, "other");
    git(roots, "init", "-q", other);
    await writeFile(join(other, "readme.txt"), "another project\n");
    git(other, "add", "readme.txt");
    git(
      other,
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "commit",
      "-q",
      "-m",
      "chore(x): start",
    );
    const outside = gitRepo().repo;
    expect([
      await reason(() => importPackage(deps, "in-1", other)),
      await reason(() => importPackage(deps, "in-1", outside)),
      await leftovers(other, history),
      calls.resumed.length,
      calls.released,
    ]).toEqual(["teleport_no_project", "cwd_outside_roots", [1, "", "", []], 0, 0]);
  });

  test("a session this host already has, a ref the manifest made up, or a package with no code is refused", async () => {
    const pkg = await packaged();
    const { repo, history, deps } = target(pkg);
    const withRef = await packaged({
      git: {
        ...(pkg.manifest.git as NonNullable<TeleportManifest["git"]>),
        ref: "refs/heads/main",
      },
    });
    const noCode = await packaged({ git: undefined });
    const local = target(pkg, { local: "/somewhere/else.jsonl" });
    const claimOf = (p: Awaited<ReturnType<typeof packaged>>, code: string | null) => ({
      ...deps,
      inbox: holding({
        manifest: p.manifest,
        transcript: p.transcript,
        code,
        release: async () => {},
      }),
    });
    expect([
      await reason(() => importPackage(local.deps, "in-1", local.repo)),
      await reason(() => importPackage(claimOf(withRef, withRef.code), "in-1", repo)),
      await reason(() => importPackage(claimOf(noCode, null), "in-1", repo)),
      await leftovers(repo, history),
    ]).toEqual(["teleport_exists", "request_invalid", "request_invalid", [1, "", "", []]]);
  });

  test("a transcript file already where this one would go stays as it is, and a head the bundle does not carry is refused", async () => {
    const pkg = await packaged();
    const { repo, history, deps } = target(pkg);
    const place = join(history, slug(join(repo, ".flightdeck", "worktrees", "teleport-feature")));
    await mkdir(place, { recursive: true });
    await writeFile(join(place, `${ID}.jsonl`), "this host's own\n");
    const there = await reason(() => importPackage(deps, "in-1", repo));
    const kept = await readFile(join(place, `${ID}.jsonl`), "utf8");
    const forged = await packaged();
    const other = target(forged);
    const wrongHead = {
      ...other.deps,
      inbox: holding({
        manifest: {
          ...forged.manifest,
          git: {
            ...(forged.manifest.git as NonNullable<TeleportManifest["git"]>),
            head: "f".repeat(40),
          },
        },
        transcript: forged.transcript,
        code: forged.code,
        release: async () => {},
      }),
    };
    expect([
      there,
      kept,
      await reason(() => importPackage(wrongHead, "in-1", other.repo)),
      (await leftovers(other.repo, other.history)).slice(0, 3),
    ]).toEqual(["teleport_exists", "this host's own\n", "request_invalid", [1, "", ""]]);
  });

  test("a folder inside the roots whose repository is outside them is refused before git writes a thing", async () => {
    const pkg = await packaged();
    const { repo, history, deps } = target(pkg);
    const sub = join(repo, "sub");
    await mkdir(sub);
    const narrow = { ...deps, allowedRoots: [sub] };
    expect([
      await reason(() => importPackage(narrow, "in-1", sub)),
      await leftovers(repo, history),
      await readFile(join(repo, ".git", "info", "exclude"), "utf8")
        .then((text) => text.includes(".flightdeck"))
        .catch(() => false),
    ]).toEqual(["cwd_outside_roots", [1, "", "", []], false]);
  });

  test("a mode that asks less arrives as the default, and the bundle's LFS files are never fetched", async () => {
    const pkg = await packaged({ permissionMode: "acceptEdits" }, { lfs: true });
    const { repo, deps, calls } = target(pkg);
    // A smudge filter of this host for LFS: it would reach a server the bundle's files name.
    const marks = tempDir("fd-teleport-marks-");
    const smudge = join(marks, "smudge.sh");
    await writeFile(smudge, `#!/bin/sh\ntouch "${join(marks, "ran")}"\ncat\n`, { mode: 0o755 });
    git(repo, "config", "filter.lfs.smudge", smudge);
    git(repo, "config", "filter.lfs.required", "true");
    const done = await importPackage(deps, "in-1", repo).catch((e: Error) => ({
      sessionId: String(e),
      worktree: "",
    }));
    expect([
      done.sessionId,
      // A pointer, as the tree has it (a host with git-lfs rewrites it as a full pointer on add).
      await readFile(join(done.worktree, "data.bin"), "utf8").then(
        (text) => text.startsWith("version https://git-lfs.github.com/spec/v1\n"),
        () => "missing",
      ),
      (calls.resumed[0] as { permissionMode?: string } | undefined)?.permissionMode,
      (await readdir(marks)).includes("ran"),
    ]).toEqual(["t1", true, "default", false]);
  });

  test("a transcript that cannot be copied is that failure, not a session already here, and nothing is left", async () => {
    const pkg = await packaged();
    const { repo, history, deps } = target(pkg);
    const gone = {
      ...deps,
      inbox: holding({
        manifest: pkg.manifest,
        transcript: join(tempDir("fd-teleport-gone-"), "transcript"),
        code: pkg.code,
        release: async () => {},
      }),
    };
    const failed = await reason(() => importPackage(gone, "in-1", repo));
    expect([failed.includes("ENOENT"), await leftovers(repo, history)]).toEqual([
      true,
      [1, "", "", []],
    ]);
  });

  test("a transcript copy that fails halfway leaves no partial file, even in a folder that was already there", async () => {
    const pkg = await packaged();
    const { repo, deps } = target(pkg);
    let place = "";
    const half: TeleportImportDeps = {
      ...deps,
      copyFile: async (_from, to) => {
        place = String(to);
        await writeFile(place, '{"type":"user"');
        throw Object.assign(new Error("no space left on device"), { code: "ENOSPC" });
      },
    };
    // The first try makes the folder and takes it back; the second finds it there already.
    await reason(() => importPackage(half, "in-1", repo));
    const folder = place ? dirname(place) : "";
    if (folder) await mkdir(folder, { recursive: true });
    const failed = await reason(() => importPackage(half, "in-1", repo));
    expect([
      failed.includes("no space left"),
      folder ? await readdir(folder) : "the copy was never asked for",
      git(repo, "branch", "--list", "fd/*").trim(),
    ]).toEqual([true, [], ""]);
  });

  test("a copy that fails on its source never removes a transcript the host has", async () => {
    const pkg = await packaged();
    const { repo, deps } = target(pkg);
    let place = "";
    const lost: TeleportImportDeps = {
      ...deps,
      copyFile: async (_from, to) => {
        place = String(to);
        throw Object.assign(new Error("no such file"), { code: "ENOENT" });
      },
    };
    // The first try learns where the transcript goes; the host's own file turns up there.
    await reason(() => importPackage(lost, "in-1", repo));
    if (place) {
      await mkdir(dirname(place), { recursive: true });
      await writeFile(place, "mine\n");
    }
    const failed = await reason(() => importPackage(lost, "in-1", repo));
    expect([failed.includes("no such file"), place ? await readFile(place, "utf8") : ""]).toEqual([
      true,
      "mine\n",
    ]);
  });

  test("a session that does not start takes its worktree, branch and transcript with it", async () => {
    const pkg = await packaged();
    const { repo, history, deps, calls } = target(pkg, { failResume: true });
    const failed = await reason(() => importPackage(deps, "in-1", repo));
    const left = await leftovers(repo, history);
    expect([failed.includes("claude would not start"), left, calls.released]).toEqual([
      true,
      [1, "", "", []],
      1,
    ]);
  });
});
