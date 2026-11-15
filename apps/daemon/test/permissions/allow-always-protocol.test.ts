import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startServer } from "../../src/server.ts";
import { tempDir } from "../support/helpers.ts";
import { FrameClient } from "../support/history-helpers.ts";
import { asking, cleanups, runCleanups } from "../support/permissions-allow-always.ts";

const TOKEN = "allow-token-0123456789abcdef";
afterEach(runCleanups);

describe("permitir-sempre pelo protocolo", () => {
  test("pelo protocolo, a recusa volta como invalid_permission_update", async () => {
    const { manager, root, requestId, open } = await asking("[tool] x");
    const server = startServer({
      manager,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [root],
    });
    cleanups.push(() => server.stop());
    const client = new FrameClient(server.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    const bad = await client.request("permission.respond", {
      requestId,
      decision: "allow",
      updatedPermissions: [{ type: "setMode", mode: "bypassPermissions", destination: "session" }],
    });
    expect(bad).toMatchObject({
      ok: false,
      error: {
        code: "invalid_permission_update",
        message: "modo bypassPermissions não é permitido",
      },
    });
    expect(open()).toBe(1);
  });

  test("over the wire, a rule that names a folder on disk is refused, and one that names a file is saved (#395)", async () => {
    const { manager, root, project, requestId, open, result } = await asking("[tool] x");
    mkdirSync(join(project, "src"), { recursive: true });
    writeFileSync(join(project, "src", ".env"), "");
    writeFileSync(join(project, "notes.txt"), "");
    const server = startServer({
      manager,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [root],
    });
    cleanups.push(() => server.stop());
    const client = new FrameClient(server.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    const rule = (ruleContent: string) => ({
      type: "addRules",
      rules: [{ toolName: "Write", ruleContent }],
      behavior: "allow",
      destination: "localSettings",
    });
    const folder = await client.request("permission.respond", {
      requestId,
      decision: "allow",
      updatedPermissions: [rule("src")],
    });
    expect(folder).toMatchObject({ ok: false, error: { code: "invalid_permission_update" } });
    expect(open()).toBe(1);
    const file = await client.request("permission.respond", {
      requestId,
      decision: "allow",
      updatedPermissions: [rule("notes.txt")],
    });
    expect(file).toMatchObject({ ok: true });
    expect((await result())?.content ?? "").toContain("notes.txt");
  });

  test.skipIf(process.platform === "win32")(
    "over the wire, a rule that names a link to a file outside the project is refused (#528)",
    async () => {
      const { manager, root, project, requestId, open, result } = await asking("[tool] x");
      const outside = tempDir();
      writeFileSync(join(outside, "profile"), "");
      symlinkSync(join(outside, "profile"), join(project, "notes.txt"));
      writeFileSync(join(project, "plain.txt"), "");
      const server = startServer({
        manager,
        hostName: "h",
        bind: "127.0.0.1",
        port: 0,
        token: TOKEN,
        allowedRoots: [root],
      });
      cleanups.push(() => server.stop());
      const client = new FrameClient(server.url);
      cleanups.push(() => client.close());
      await client.request("hello", { token: TOKEN, client: "t" });
      const rule = (ruleContent: string) => ({
        type: "addRules",
        rules: [{ toolName: "Write", ruleContent }],
        behavior: "allow",
        destination: "localSettings",
      });
      const link = await client.request("permission.respond", {
        requestId,
        decision: "allow",
        updatedPermissions: [rule("notes.txt")],
      });
      expect(link).toMatchObject({ ok: false, error: { code: "invalid_permission_update" } });
      expect(open()).toBe(1);
      const plain = await client.request("permission.respond", {
        requestId,
        decision: "allow",
        updatedPermissions: [rule("plain.txt")],
      });
      expect(plain).toMatchObject({ ok: true });
      expect((await result())?.content ?? "").toContain("plain.txt");
    },
  );

  test("over the wire, the file a Write is about to create gets its rule; another path not there yet does not (#395)", async () => {
    const { manager, root, requestId, open, result } = await asking("[tool] x");
    const server = startServer({
      manager,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [root],
    });
    cleanups.push(() => server.stop());
    const client = new FrameClient(server.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    const rule = (ruleContent: string) => ({
      type: "addRules",
      rules: [{ toolName: "Write", ruleContent }],
      behavior: "allow",
      destination: "localSettings",
    });
    const other = await client.request("permission.respond", {
      requestId,
      decision: "allow",
      updatedPermissions: [rule("later.txt")],
    });
    expect(other).toMatchObject({ ok: false, error: { code: "invalid_permission_update" } });
    expect(open()).toBe(1);
    // The fake runtime's Write creates fake.txt, which is not on disk until it is allowed.
    const own = await client.request("permission.respond", {
      requestId,
      decision: "allow",
      updatedPermissions: [rule("fake.txt")],
    });
    expect(own).toMatchObject({ ok: true });
    expect((await result())?.content ?? "").toContain("fake.txt");
  });
});
