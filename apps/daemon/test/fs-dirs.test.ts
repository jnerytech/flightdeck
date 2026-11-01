import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import * as protocol from "@flightdeck/protocol";
import { listDirs } from "../src/fs-dirs.ts";
import { type RunningServer, startServer } from "../src/server.ts";
import { newManager, poll, tempDir } from "./helpers.ts";

/** A root with `code/{app,lib,.git}`, a file, and a sibling folder outside it. */
function tree() {
  const base = realpathSync(tempDir("fd-fsdirs-"));
  const root = join(base, "root");
  const outside = join(base, "outside");
  for (const dir of ["code/app", "code/lib", "code/.git", "other"]) {
    mkdirSync(join(root, dir), { recursive: true });
  }
  mkdirSync(join(outside, "secret"), { recursive: true });
  writeFileSync(join(root, "code", "notes.txt"), "x");
  return { base, root, outside };
}

const names = (listing: { dirs: Array<{ name: string }> }) => listing.dirs.map((d) => d.name);

describe("fs-dirs: listing the folders of a host", () => {
  test("without a path it lists the allowed roots, and leaves out one that is gone", () => {
    const { root, base } = tree();
    const listing = listDirs(undefined, [root, join(base, "gone")]);
    expect(listing).toEqual({
      path: null,
      parent: null,
      dirs: [{ name: "root", path: root }],
      truncated: false,
    });
  });

  test("a folder lists its subfolders only: no files, no hidden ones, sorted", () => {
    const { root } = tree();
    const listing = listDirs(join(root, "code"), [root]);
    expect(listing.path).toBe(join(root, "code"));
    expect(names(listing)).toEqual(["app", "lib"]);
    expect(listing.dirs[0]?.path).toBe(join(root, "code", "app"));
  });

  test("hidden folders show only when asked", () => {
    const { root } = tree();
    expect(names(listDirs(join(root, "code"), [root], { hidden: true }))).toEqual([
      ".git",
      "app",
      "lib",
    ]);
  });

  test("the parent is the folder above, and null at a root", () => {
    const { root } = tree();
    expect(listDirs(join(root, "code"), [root]).parent).toBe(root);
    expect(listDirs(root, [root]).parent).toBeNull();
  });

  test("more subfolders than the cap come back cut, and say so", () => {
    const { root } = tree();
    const listing = listDirs(join(root, "code"), [root], { cap: 1 });
    expect(names(listing)).toEqual(["app"]);
    expect(listing.truncated).toBe(true);
    expect(listDirs(join(root, "code"), [root], { cap: 2 }).truncated).toBe(false);
  });

  test("a path outside the roots is refused: absolute, with .., or a sibling that shares the name's start", () => {
    const { root, outside, base } = tree();
    mkdirSync(join(base, "root-evil"));
    for (const path of [
      outside,
      join(root, "..", "outside"),
      join(root, "code", "..", "..", "outside", "secret"),
      join(base, "root-evil"),
      "/",
    ]) {
      expect(() => listDirs(path, [root])).toThrow(/outside allowedRoots/);
    }
  });

  test("a folder that does not exist, or a file, is refused", () => {
    const { root } = tree();
    expect(() => listDirs(join(root, "nope"), [root])).toThrow(/does not exist/);
    expect(() => listDirs(join(root, "code", "notes.txt"), [root])).toThrow(/does not exist/);
  });

  test("a symlink out of the roots is neither listed nor followed", () => {
    const { root, outside } = tree();
    symlinkSync(outside, join(root, "code", "escape"));
    expect(names(listDirs(join(root, "code"), [root]))).toEqual(["app", "lib"]);
    expect(() => listDirs(join(root, "code", "escape"), [root])).toThrow(/outside allowedRoots/);
    expect(() => listDirs(join(root, "code", "escape", "secret"), [root])).toThrow(
      /outside allowedRoots/,
    );
  });

  test("a symlink to a folder inside the roots is listed under its real path", () => {
    const { root } = tree();
    symlinkSync(join(root, "other"), join(root, "code", "shortcut"));
    const listing = listDirs(join(root, "code"), [root]);
    expect(listing.dirs.find((d) => d.name === "shortcut")?.path).toBe(join(root, "other"));
  });

  test("a root that is itself reached through a link is compared by real path", () => {
    const { base, root } = tree();
    symlinkSync(root, join(base, "link-to-root"));
    const listing = listDirs(join(base, "link-to-root", "code"), [join(base, "link-to-root")]);
    expect(listing.path).toBe(join(root, "code"));
    expect(listing.parent).toBe(root);
  });
});

const TOKEN = "fs-dirs-token-0123456789";
const stops: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
});

/** hello, then one command; the `ack` of the command. */
async function ask(server: RunningServer, type: string, payload: object) {
  const ws = new WebSocket(server.url);
  const acks: protocol.Ack[] = [];
  ws.addEventListener("message", (m) => {
    const msg = protocol.parseServerMessage(String(m.data));
    if (msg.type === "ack") acks.push(msg);
  });
  await new Promise((r) => ws.addEventListener("open", r));
  ws.send(JSON.stringify({ id: "1", type: "hello", payload: { token: TOKEN, client: "t" } }));
  ws.send(JSON.stringify({ id: "2", type, payload }));
  const ack = await poll(() => acks.find((a) => a.id === "2"), 2000);
  ws.close();
  return ack;
}

describe("fs-dirs: the fs.dirs command", () => {
  test("the server answers fs.dirs for its allowed roots, and refuses a path outside them", async () => {
    const { root, outside } = tree();
    const ctx = newManager();
    const server = startServer({
      manager: ctx.manager,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [root],
    });
    stops.push(() => server.stop());
    expect(protocol.Command.safeParse({ id: "1", type: "fs.dirs", payload: {} }).success).toBe(
      true,
    );
    const roots = await ask(server, "fs.dirs", {});
    expect(roots?.ok && roots.data).toEqual({
      path: null,
      parent: null,
      dirs: [{ name: "root", path: root }],
      truncated: false,
    });
    const code = await ask(server, "fs.dirs", { path: join(root, "code") });
    expect(
      code?.ok && (code.data as { dirs: Array<{ name: string }> }).dirs.map((d) => d.name),
    ).toEqual(["app", "lib"]);
    const hidden = await ask(server, "fs.dirs", { path: join(root, "code"), hidden: true });
    expect(hidden?.ok && (hidden.data as { dirs: unknown[] }).dirs).toHaveLength(3);
    const refused = await ask(server, "fs.dirs", { path: outside });
    expect(refused && !refused.ok && refused.error.code).toBe("forbidden_cwd");
    // The folder's own parent is never offered above the root.
    expect(dirname(root)).not.toBe(root);
  });

  test("host.info announces fs.dirs, so the app only offers the picker where it works", async () => {
    const { root } = tree();
    const ctx = newManager();
    const server = startServer({
      manager: ctx.manager,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [root],
      fsDirs: true,
    });
    stops.push(() => server.stop());
    const info = await ask(server, "host.info", {});
    expect(info?.ok && (info.data as { features: string[] }).features).toContain("fs.dirs");
    // A server that was not given it announces nothing: the other tests count the features.
    const bare = startServer({
      manager: ctx.manager,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [root],
    });
    stops.push(() => bare.stop());
    const none = await ask(bare, "host.info", {});
    expect(none?.ok && (none.data as { features: string[] }).features).toEqual([]);
  });
});
