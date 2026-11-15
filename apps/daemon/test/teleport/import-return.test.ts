import { describe, expect, test } from "bun:test";
import { mkdir, readdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { importPackage, isPrefix } from "../../src/teleport/import.ts";
import { tempDir } from "../support/helpers.ts";
import {
  ID,
  leftovers,
  onWindows,
  packaged,
  reason,
  slug,
  TRANSCRIPT,
  target,
} from "./import-setup.ts";

describe("teleport-import: a session that comes back replaces this host's copy (#870)", () => {
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
    const { repo, deps, calls } = target(pkg, {
      local: file,
      mine: [
        { id: "old", status: "ended" },
        { id: "older", status: "idle" },
      ],
    });
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
      calls.closedAtResume,
      calls.unarchived,
    ]).toEqual([
      "t1",
      [`${ID}.jsonl.replaced-2026-11-07T12-00-00-000Z`],
      TRANSCRIPT.slice(0, 20),
      TRANSCRIPT,
      // Every record of it here ends, before the copy is set aside: none writes to it meanwhile.
      ["old", "older"],
      ["old", "older"],
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
    // An ended record first, and one still at work after it: any record at work refuses.
    const b = target(pkg, {
      local: busy.file,
      mine: [
        { id: "old", status: "ended" },
        { id: "newer", status: "running" },
      ],
    });
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
      mine: [{ id: "old", status: "ended" }],
    });
    const failed = await reason(() =>
      importPackage({ ...deps, historyRoot: history }, "in-1", repo),
    );
    expect([
      failed.includes("claude would not start"),
      await readdir(folder),
      await readFile(file, "utf8"),
      // The records here ended before the start: they were idle or ended, and stay so.
      [...calls.closed, ...calls.unarchived],
      await leftovers(repo, history),
    ]).toEqual([
      true,
      [`${ID}.jsonl`],
      TRANSCRIPT.slice(0, 20),
      ["old"],
      [1, "", "", ["-work-app"]],
    ]);
  });

  test("an old record that will not end stops the return before the copy here is touched (#870)", async () => {
    const pkg = await packaged();
    const history = tempDir("fd-teleport-history-");
    const { folder, file } = await localCopy(history, TRANSCRIPT.slice(0, 20));
    const { repo, deps, calls } = target(pkg, {
      local: file,
      mine: [{ id: "old", status: "idle" }],
      failClose: true,
    });
    expect([
      await reason(() => importPackage({ ...deps, historyRoot: history }, "in-1", repo)),
      await readdir(folder),
      calls.resumed.length,
      calls.unarchived,
    ]).toEqual(["teleport_exists", [`${ID}.jsonl`], 0, []]);
  });

  test("a session that came back and started is not undone when it cannot be shown again (#870)", async () => {
    const pkg = await packaged();
    const history = tempDir("fd-teleport-history-");
    const { file } = await localCopy(history, TRANSCRIPT.slice(0, 20));
    const { repo, deps } = target(pkg, { local: file, failUnarchive: true });
    const done = await importPackage({ ...deps, historyRoot: history }, "in-1", repo).catch(
      (e: Error) => ({ sessionId: String(e), worktree: "" }),
    );
    expect([done.sessionId, done.worktree !== ""]).toEqual(["t1", true]);
  });

  test("the prefix is compared over every chunk, and a link or a folder is never a copy (#870)", async () => {
    const dir = tempDir("fd-teleport-prefix-");
    const big = "x".repeat(200 * 1024);
    const at = (name: string, text: string) =>
      writeFile(join(dir, name), text).then(() => join(dir, name));
    const local = await at("local", big);
    const longer = await at("longer", `${big}more turns\n`);
    // One byte differs in the second chunk of 64 KiB.
    const second = await at("second", `${big.slice(0, 100_000)}y${big.slice(100_001)}more\n`);
    let linked: boolean | string = "no links here";
    if (!onWindows) {
      await symlink(local, join(dir, "link"));
      linked = await isPrefix(join(dir, "link"), longer);
    }
    expect([
      await isPrefix(local, longer),
      await isPrefix(local, second),
      await isPrefix(longer, local),
      await isPrefix(dir, longer),
      linked,
    ]).toEqual([true, false, false, false, onWindows ? "no links here" : false]);
  });

  test("a copy put back never writes over a file that appeared there meanwhile: it stays set aside (#870)", async () => {
    const pkg = await packaged();
    const history = tempDir("fd-teleport-history-");
    const { folder, file } = await localCopy(history, TRANSCRIPT.slice(0, 20));
    const { repo, deps } = target(pkg, {
      local: file,
      failResume: true,
      whileStarting: () => writeFile(file, "a new session here\n"),
    });
    await reason(() => importPackage({ ...deps, historyRoot: history }, "in-1", repo));
    expect([
      (await readdir(folder)).sort(),
      await readFile(file, "utf8"),
      await readFile(join(folder, `${ID}.jsonl.replaced-2026-11-07T12-00-00-000Z`), "utf8").catch(
        () => "missing",
      ),
    ]).toEqual([
      [`${ID}.jsonl`, `${ID}.jsonl.replaced-2026-11-07T12-00-00-000Z`],
      "a new session here\n",
      TRANSCRIPT.slice(0, 20),
    ]);
  });
});
