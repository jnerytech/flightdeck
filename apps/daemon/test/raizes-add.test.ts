import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, realpathSync } from "node:fs";
import { join, parse } from "node:path";
import { startServer } from "../src/server.ts";
import { newManager, tempDir, testRootsPlatform } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

const TOKEN = "roots-token-0123456789abcdef";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function serve(extra: object = {}) {
  const { manager, root } = newManager();
  const roots = [root];
  const saved: Array<readonly string[]> = [];
  const server = startServer({
    manager,
    hostName: "h",
    bind: "127.0.0.1",
    port: 0,
    token: TOKEN,
    allowedRoots: roots,
    persistRoots: (list) => saved.push([...list]),
    rootsPlatform: testRootsPlatform(),
    ...extra,
  });
  cleanups.push(() => server.stop());
  const client = new FrameClient(server.url);
  cleanups.push(() => client.close());
  await client.request("hello", { token: TOKEN, client: "t" });
  return { client, roots, saved, root };
}

const refusal = (ack: Record<string, unknown>) =>
  (ack.error ?? {}) as { code?: string; reason?: string; params?: Record<string, unknown> };

describe("roots.add", () => {
  test("adds the folder to the live list, keeps it, and answers the list", async () => {
    const { client, roots, saved, root } = await serve();
    const vault = realpathSync(tempDir("fd-vault-"));
    const ack = await client.request("roots.add", { path: vault, confirm: true });
    expect(ack.ok).toBe(true);
    expect((ack.data as { allowedRoots: string[] }).allowedRoots).toEqual([root, vault]);
    expect(roots).toEqual([root, vault]);
    expect(saved).toEqual([[root, vault]]);
  });

  test("a session can start in the new folder at once", async () => {
    const { client } = await serve();
    const vault = realpathSync(tempDir("fd-vault-"));
    const before = refusal(await client.request("fs.dirs", { path: vault }));
    expect(before.reason).toBe("cwd_outside_roots");
    await client.request("roots.add", { path: vault, confirm: true });
    const after = await client.request("fs.dirs", { path: vault });
    expect(after.ok).toBe(true);
  });

  test("without the person's confirmation nothing changes", async () => {
    const { client, roots, saved } = await serve();
    const ack = await client.request("roots.add", { path: tempDir("fd-vault-") });
    expect(refusal(ack).reason).toBe("root_confirm");
    expect(roots).toHaveLength(1);
    expect(saved).toEqual([]);
  });

  test("a folder already inside an allowed one is not added again", async () => {
    const { client, roots, saved, root } = await serve();
    const inner = join(root, "inner");
    mkdirSync(inner);
    const ack = await client.request("roots.add", { path: inner, confirm: true });
    expect(ack.ok).toBe(true);
    expect(roots).toEqual([root]);
    expect(saved).toEqual([]);
  });

  test("the root of the file system is refused as a system folder", async () => {
    const { client, roots } = await serve();
    const fsRoot = parse(process.cwd()).root;
    const ack = await client.request("roots.add", { path: fsRoot, confirm: true });
    expect(refusal(ack).reason).toBe("root_system");
    expect(roots).toHaveLength(1);
  });

  test("a system folder is refused, and so is a folder inside one", async () => {
    const { client } = await serve();
    const sys = process.platform === "win32" ? "C:\\Windows" : "/etc";
    expect(refusal(await client.request("roots.add", { path: sys, confirm: true })).reason).toBe(
      "root_system",
    );
  });

  test("the system-folder rule reads the platform it was given: that home's secret folders are refused", async () => {
    const home = realpathSync(tempDir("fd-home-"));
    const secret = join(home, ".ssh");
    mkdirSync(secret);
    const plain = await serve();
    expect((await plain.client.request("roots.add", { path: secret, confirm: true })).ok).toBe(
      true,
    );
    const given = await serve({ rootsPlatform: { platform: process.platform, env: {}, home } });
    const ack = await given.client.request("roots.add", { path: secret, confirm: true });
    expect(refusal(ack).reason).toBe("root_system");
  });

  test("a folder that does not exist is refused as missing", async () => {
    const { client, roots } = await serve();
    const ack = await client.request("roots.add", {
      path: join(tempDir("fd-vault-"), "nope"),
      confirm: true,
    });
    expect(refusal(ack).reason).toBe("root_missing");
    expect(roots).toHaveLength(1);
  });
});
