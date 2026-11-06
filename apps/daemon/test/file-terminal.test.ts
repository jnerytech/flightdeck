import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ReviewTarget } from "@flightdeck/protocol";
import { Changes } from "../src/review/changes.ts";
import { ReviewFiles } from "../src/review/files.ts";
import { startServer } from "../src/server.ts";
import { TerminalManager } from "../src/terminal/terminal-manager.ts";
import { newManager, tempDir } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";
import { fakePtys } from "./pty-helpers.ts";

const TOKEN = "file-terminal-token-0123456789abcdef";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/**
 * Issue #506: a path a terminal printed opens in the Files viewer. The viewer reads through a
 * `terminal:<id>` target whose root is the folder the terminal was opened in (checked against the
 * allowed roots when it opened), never a folder the client names.
 */
async function setup() {
  const ctx = newManager();
  const folder = join(ctx.project, "pkg");
  mkdirSync(folder);
  writeFileSync(join(folder, "a.ts"), "one\ntwo\nthree\n");
  writeFileSync(join(folder, ".env"), "KEY=value\n");
  writeFileSync(join(ctx.project, "outside.txt"), "above the terminal's folder\n");
  const ptys = fakePtys();
  const terminals = new TerminalManager({
    pty: ptys.factory,
    allowedRoots: [ctx.root],
    platform: "linux",
    env: () => ({ SHELL: "/bin/zsh" }),
    which: () => null,
  });
  cleanups.push(() => terminals.stop());
  const { terminalId } = await terminals.open({ cwd: folder, cols: 80, rows: 24 });
  // A daemon-internal terminal runs in the daemon's own folder, outside the allowed roots.
  const own = tempDir("fd-own-");
  const internal = await terminals.open({ cwd: own, internal: true, cols: 80, rows: 24 });
  const files = new ReviewFiles({
    changes: new Changes({ db: ctx.store.db, terminals }),
    dataDir: tempDir("fd-data-"),
    allowedRoots: [ctx.root],
  });
  return { ...ctx, folder, terminals, terminalId, internalId: internal.terminalId, files };
}

const reason = (promise: Promise<unknown>) =>
  promise.then(
    () => "ok",
    (error: { reason?: string }) => error.reason ?? "error",
  );

describe("file-terminal: a terminal's folder is a target of the Files viewer (#506)", () => {
  test("the protocol takes a terminal target", () => {
    expect(ReviewTarget.safeParse("terminal:t-1").success).toBe(true);
  });

  test("a file in the terminal's folder reads through terminal:<id>", async () => {
    const { files, terminalId } = await setup();
    const file = await files.read(`terminal:${terminalId}`, "a.ts").catch(() => null);
    expect(file?.text ?? "").toBe("one\ntwo\nthree\n");
  });

  test("the root is the terminal's folder: above it, a credential, an unknown or an internal terminal are refused", async () => {
    const { files, terminalId, internalId } = await setup();
    expect(
      await Promise.all([
        reason(files.read(`terminal:${terminalId}`, "../outside.txt")),
        reason(files.read(`terminal:${terminalId}`, ".env")),
        reason(files.read("terminal:nope", "a.ts")),
        reason(files.read(`terminal:${internalId}`, "a.ts")),
      ]),
    ).toEqual([
      "review_path_outside",
      "review_file_secret",
      "terminal_missing",
      "terminal_missing",
    ]);
  });

  test("a host with files and terminals announces file.terminal", async () => {
    const ctx = await setup();
    const server = startServer({
      manager: ctx.manager,
      files: ctx.files,
      terminals: ctx.terminals,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [ctx.root],
    });
    cleanups.push(() => server.stop());
    const client = new FrameClient(server.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    const info = await client.data<{ features?: string[] }>("host.info", {});
    expect(info?.features ?? []).toContain("file.terminal");
  });
});
