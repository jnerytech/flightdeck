import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as protocol from "@flightdeck/protocol";
import { listFiles } from "../src/fs-dirs.ts";
import { type RunningServer, startServer } from "../src/server.ts";
import { newManager, poll, tempDir } from "./helpers.ts";

/** A root with `code/{app/, b.ts, A.ts, .env, link -> ../secret.txt}`, `.git/HEAD` and an outside file. */
function tree() {
  const base = realpathSync(tempDir("fd-fsfiles-"));
  const root = join(base, "root");
  for (const dir of ["code/app", "code/.git", "code/node_modules"]) {
    mkdirSync(join(root, dir), { recursive: true });
  }
  for (const file of [
    "code/b.ts",
    "code/A.ts",
    "code/.env",
    "code/.git/HEAD",
    "code/node_modules/x.js",
  ]) {
    writeFileSync(join(root, file), "x");
  }
  writeFileSync(join(base, "secret.txt"), "s");
  symlinkSync(join(base, "secret.txt"), join(root, "code", "link.txt"));
  return { base, root };
}

describe("fs-files: listing the files of a folder of a host", () => {
  test("it lists the files only, sorted, with no hidden ones, no folders and no link out of the roots", () => {
    const { root } = tree();
    const listing = listFiles(join(root, "code"), [root]);
    expect(listing.path).toBe(join(root, "code"));
    expect(listing.files).toEqual([
      { name: "A.ts", path: join(root, "code", "A.ts") },
      { name: "b.ts", path: join(root, "code", "b.ts") },
    ]);
    expect(listing.truncated).toBe(false);
    expect(
      listFiles(join(root, "code"), [root], { hidden: true }).files.map((f) => f.name),
    ).toEqual([".env", "A.ts", "b.ts"]);
  });

  test("it stops at the cap, saying so", () => {
    const { root } = tree();
    const listing = listFiles(join(root, "code"), [root], { cap: 1 });
    expect(listing.files).toHaveLength(1);
    expect(listing.truncated).toBe(true);
  });

  test("the inside of .git and node_modules is never listed", () => {
    const { root } = tree();
    expect(listFiles(join(root, "code", ".git"), [root], { hidden: true }).files).toEqual([]);
    expect(listFiles(join(root, "code", "node_modules"), [root]).files).toEqual([]);
  });

  test("a folder outside the roots is refused like fs.dirs does", () => {
    const { root, base } = tree();
    expect(() => listFiles(base, [root])).toThrow();
  });
});

const TOKEN = "fs-files-token-0123456789";
const stops: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
});

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

describe("fs-files: the fs.files command", () => {
  test("it answers for a folder of the roots, refuses one outside, and host.info announces it", async () => {
    const { root, base } = tree();
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
    const ok = await ask(server, "fs.files", { path: join(root, "code") });
    expect(
      ok?.ok && (ok.data as { files: Array<{ name: string }> }).files.map((f) => f.name),
    ).toEqual(["A.ts", "b.ts"]);
    const refused = await ask(server, "fs.files", { path: base });
    expect(refused && !refused.ok && refused.error.code).toBe("forbidden_cwd");
    const info = await ask(server, "host.info", {});
    expect(info?.ok && (info.data as { features: string[] }).features).toContain("fs.files");
  });
});
