import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { startServer } from "../../src/server.ts";
import { cleanups, runCleanups, turnInRepo } from "../support/checkpoints-rewind.ts";
import { newManager } from "../support/helpers.ts";
import { FrameClient } from "../support/history-helpers.ts";

const TOKEN = "rewind-token-0123456789abcdef";

afterEach(runCleanups);

describe("rewind", () => {
  test("protocolo: rewind.preview, rewind.apply (com confirm) e rewind.undo", async () => {
    const { rewinder, repo, turn, snapshots } = await turnInRepo();
    const { manager } = newManager();
    const server = startServer({
      manager,
      checkpoints: { snapshots, rewinder },
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [],
    });
    cleanups.push(() => server.stop());
    const client = new FrameClient(server.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    const preview = await client.data<{ via: string }>("rewind.preview", {
      claudeSessionId: "s1",
      turn,
    });
    expect(preview?.via).toBe("snapshot");
    expect(await client.request("rewind.apply", { claudeSessionId: "s1", turn })).toMatchObject({
      ok: false,
      error: { code: "invalid_state" },
    });
    await client.data("rewind.apply", { claudeSessionId: "s1", turn, confirm: true });
    expect(existsSync(join(repo, "novo.txt"))).toBe(false);
    await client.data("rewind.undo", { claudeSessionId: "s1", confirm: true });
    expect(existsSync(join(repo, "novo.txt"))).toBe(true);
  });
  test("protocolo: rewind.undoPreview lists what an undo would change, writes nothing and asks no confirm (#4041)", async () => {
    const { rewinder, repo, turn, snapshots } = await turnInRepo();
    const { manager } = newManager();
    const server = startServer({
      manager,
      checkpoints: { snapshots, rewinder },
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [],
    });
    cleanups.push(() => server.stop());
    const client = new FrameClient(server.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    // No rewind yet: refused with the undo's own reason.
    expect(await client.request("rewind.undoPreview", { claudeSessionId: "s1" })).toMatchObject({
      ok: false,
      error: { code: "not_found" },
    });
    await client.data("rewind.apply", { claudeSessionId: "s1", turn, confirm: true });
    const preview = await client.data<{ files: Array<{ path: string }> }>("rewind.undoPreview", {
      claudeSessionId: "s1",
    });
    expect(preview?.files.map((file) => file.path)).toEqual([
      "README.md",
      "apagar.txt",
      "novo.txt",
    ]);
    expect(existsSync(join(repo, "novo.txt"))).toBe(false);
  });
});
