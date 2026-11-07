import { describe, expect, test } from "bun:test";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SessionStatus, TeleportManifest } from "@flightdeck/protocol";
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
  options: {
    local?: string | null;
    failResume?: boolean;
    mine?: { id: string; status: SessionStatus } | null;
  } = {},
) {
  const roots = tempDir("fd-teleport-target-");
  const repo = join(roots, "app");
  git(roots, "clone", "-q", pkg.remote, repo);
  const history = tempDir("fd-teleport-history-");
  const calls = {
    released: 0,
    resumed: [] as unknown[],
    closed: [] as string[],
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
      if (options.failResume) throw new Error("claude would not start");
      return { sessionId: "t1" };
    },
    sessionOf: () => options.mine ?? null,
    close: async (sessionId) => {
      calls.closed.push(sessionId);
    },
    unarchive: (claudeSessionId) => {
      calls.unarchived.push(claudeSessionId);
    },
    now: () => new Date("2026-11-07T12:00:00.000Z"),
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

  /** This host's own copy of the session, in the folder of the checkout it ran in. */
  async function localCopy(history: string, text: string) {
    const folder = join(history, "-work-app");
    await mkdir(folder, { recursive: true });
    const file = join(folder, `${ID}.jsonl`);
    await writeFile(file, text);
    return { folder, file };
  }

  test("a session that comes back with more turns replaces this host's copy, kept aside, and shows again (#870)", async () => {
    const pkg = await packaged();
    const history = tempDir("fd-teleport-history-");
    // The copy it left here: the first bytes of the transcript that comes back.
    const { folder, file } = await localCopy(history, TRANSCRIPT.slice(0, 20));
    const { repo, deps, calls } = target(pkg, { local: file, mine: { id: "old", status: "idle" } });
    const done = await importPackage({ ...deps, historyRoot: history }, "in-1", repo);
    expect([
      done.sessionId,
      (await readdir(folder)).sort(),
      await readFile(join(folder, `${ID}.jsonl.replaced-2026-11-07T12-00-00-000Z`), "utf8").catch(
        () => "missing",
      ),
      await readFile(join(history, slug(done.worktree), `${ID}.jsonl`), "utf8").catch(
        () => "missing",
      ),
      calls.closed,
      calls.unarchived,
    ]).toEqual([
      "t1",
      [`${ID}.jsonl.replaced-2026-11-07T12-00-00-000Z`],
      TRANSCRIPT.slice(0, 20),
      TRANSCRIPT,
      ["old"],
      [ID],
    ]);
  });

  test("a copy here with turns the incoming one lacks, or one still at work, is refused and stays as it is (#870)", async () => {
    const pkg = await packaged();
    const history = tempDir("fd-teleport-history-");
    const diverged = await localCopy(history, "this host's own turn\n");
    const other = tempDir("fd-teleport-history-");
    const busy = await localCopy(other, TRANSCRIPT.slice(0, 20));
    const a = target(pkg, { local: diverged.file });
    const b = target(pkg, { local: busy.file, mine: { id: "old", status: "running" } });
    expect([
      await reason(() => importPackage({ ...a.deps, historyRoot: history }, "in-1", a.repo)),
      await reason(() => importPackage({ ...b.deps, historyRoot: other }, "in-1", b.repo)),
      await readFile(diverged.file, "utf8"),
      await readFile(busy.file, "utf8"),
      [...a.calls.closed, ...b.calls.closed, ...a.calls.unarchived, ...b.calls.unarchived],
      a.calls.released + b.calls.released,
    ]).toEqual([
      "teleport_exists",
      "teleport_exists",
      "this host's own turn\n",
      TRANSCRIPT.slice(0, 20),
      [],
      0,
    ]);
  });

  test("a copy that grew after the checks is put back and refused; nothing was moved over it (#870)", async () => {
    const pkg = await packaged();
    const history = tempDir("fd-teleport-history-");
    const { folder, file } = await localCopy(history, TRANSCRIPT.slice(0, 20));
    const { repo, deps, calls } = target(pkg, { local: file });
    // The session wrote here between the checks and the claim.
    const claim = deps.inbox.claim;
    const growing = {
      ...deps,
      historyRoot: history,
      inbox: {
        ...deps.inbox,
        claim: async (id: string) => {
          await writeFile(file, `${TRANSCRIPT.slice(0, 20)} and a turn here\n`);
          return claim(id);
        },
      },
    };
    expect([
      await reason(() => importPackage(growing, "in-1", repo)),
      await readdir(folder),
      await readFile(file, "utf8"),
      calls.resumed.length + calls.closed.length + calls.unarchived.length,
      await leftovers(repo, history),
    ]).toEqual([
      "teleport_exists",
      [`${ID}.jsonl`],
      `${TRANSCRIPT.slice(0, 20)} and a turn here\n`,
      0,
      [1, "", "", ["-work-app"]],
    ]);
  });

  test("a returning session that does not start puts this host's copy back as it was (#870)", async () => {
    const pkg = await packaged();
    const history = tempDir("fd-teleport-history-");
    const { folder, file } = await localCopy(history, TRANSCRIPT.slice(0, 20));
    const { repo, deps, calls } = target(pkg, {
      local: file,
      failResume: true,
      mine: { id: "old", status: "ended" },
    });
    const failed = await reason(() =>
      importPackage({ ...deps, historyRoot: history }, "in-1", repo),
    );
    expect([
      failed.includes("claude would not start"),
      await readdir(folder),
      await readFile(file, "utf8"),
      [...calls.closed, ...calls.unarchived],
      await leftovers(repo, history),
    ]).toEqual([true, [`${ID}.jsonl`], TRANSCRIPT.slice(0, 20), [], [1, "", "", ["-work-app"]]]);
  });
});
