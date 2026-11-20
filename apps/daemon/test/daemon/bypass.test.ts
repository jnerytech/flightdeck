import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../../src/config.ts";
import { startDaemon } from "../../src/main.ts";
import { newManager, tempDir, workspace } from "../support/helpers.ts";
import { FrameClient } from "../support/history-helpers.ts";

const TOKEN = "bypass-switch-token-0123456789abcdef0";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** A fake-runtime daemon and a client on its loopback address. */
async function daemon(config: Record<string, unknown> = {}) {
  const dir = tempDir();
  const { root, project } = workspace();
  const file = join(dir, "config.json");
  writeFileSync(
    file,
    JSON.stringify({
      port: 0,
      token: TOKEN,
      dataDir: join(dir, "data"),
      allowedRoots: [root],
      history: { roots: [join(dir, "nada")] },
      ...config,
    }),
  );
  const running = await startDaemon(
    { command: "start", config: file, runtime: "fake" },
    {},
    { log: () => {}, error: () => {} },
  );
  cleanups.push(() => running.stop());
  const client = new FrameClient(`ws://127.0.0.1:${new URL(running.url).port}/v1/ws`);
  cleanups.push(() => client.close());
  await client.request("hello", { token: TOKEN, client: "t" });
  const refusal = async (type: string, payload: unknown) => {
    const ack = await client.request(type, payload);
    const error = ack.error as { code?: string; reason?: string } | undefined;
    return ack.ok === true ? "ok" : `${error?.code}/${error?.reason}`;
  };
  return { client, project, file, refusal };
}

describe("bypass-daemon", () => {
  test("a host starts with bypass on: the config says true and host.info announces it (#3427)", async () => {
    const { client, file } = await daemon();
    const config = await loadConfig(file);
    expect([config.allowBypassPermissions, config.defaultPermissionMode]).toEqual([
      true,
      "bypassPermissions",
    ]);
    const info = await client.data<{ allowBypassPermissions?: boolean }>("host.info", {});
    expect(info?.allowBypassPermissions).toBe(true);
  });

  test("a config that says otherwise keeps its value (#3427)", async () => {
    const { client, file } = await daemon({
      allowBypassPermissions: false,
      defaultPermissionMode: "default",
    });
    const config = await loadConfig(file);
    expect([config.allowBypassPermissions, config.defaultPermissionMode]).toEqual([
      false,
      "default",
    ]);
    const info = await client.data<{ allowBypassPermissions?: boolean }>("host.info", {});
    expect(info?.allowBypassPermissions).toBe(false);
  });

  test("a session created with no mode starts in bypassPermissions while the switch is on (#3427)", async () => {
    const { manager, store, project } = newManager({
      allowBypass: () => true,
      defaultPermissionMode: "bypassPermissions",
    });
    await manager.create({ cwd: project, prompt: "go" });
    expect(store.listSessions()[0]?.permissionMode).toBe("bypassPermissions");
  });

  test("a session Flightdeck opens by itself with no mode starts in the default mode, so run_with_secret stays denied there (#3427)", async () => {
    const { manager, store, project } = newManager({
      allowBypass: () => true,
      defaultPermissionMode: "bypassPermissions",
    });
    await manager.create({ cwd: project, prompt: "go" }, { unattended: true });
    await manager.create(
      { cwd: project, prompt: "go", permissionMode: "bypassPermissions" },
      { unattended: true },
    );
    expect(
      store
        .listSessions()
        .map((session) => session.permissionMode)
        .sort((a, b) => a.localeCompare(b)),
    ).toEqual(["bypassPermissions", "default"]);
  });

  test("with the switch off a session with no mode starts in the default mode, and asking for bypass is still refused (#3427)", async () => {
    const { manager, store, project } = newManager({
      allowBypass: () => false,
      defaultPermissionMode: "bypassPermissions",
    });
    const outcome = await manager.create({ cwd: project, prompt: "go" }).then(
      () => "created",
      (error: { reason?: string }) => error.reason,
    );
    expect(outcome).toBe("created");
    expect(store.listSessions()[0]?.permissionMode).toBe("default");
    await expect(
      manager.create({ cwd: project, prompt: "go", permissionMode: "bypassPermissions" }),
    ).rejects.toThrow(/permission prompts/);
    expect(manager.modeOf(null)).toBe("default");
  });

  test("the manager refuses a bypass session while the switch is off, and creates none", async () => {
    const { manager, store, project } = newManager({ allowBypass: () => false });
    await expect(
      manager.create({ cwd: project, prompt: "go", permissionMode: "bypassPermissions" }),
    ).rejects.toThrow(/permission prompts/);
    expect(store.listSessions()).toEqual([]);
    // Any other mode is not affected.
    await manager.create({ cwd: project, prompt: "go", permissionMode: "acceptEdits" });
    expect(store.listSessions()).toHaveLength(1);
  });

  test("with the switch on the session starts in bypassPermissions", async () => {
    const { manager, store, project } = newManager({ allowBypass: () => true });
    await manager.create({ cwd: project, prompt: "go", permissionMode: "bypassPermissions" });
    expect(store.listSessions()[0]?.permissionMode).toBe("bypassPermissions");
  });

  test("turning it on asks for confirm, writes the config and is felt at once; off needs none", async () => {
    const { client, project, file, refusal } = await daemon({ allowBypassPermissions: false });
    const create = { cwd: project, prompt: "go", permissionMode: "bypassPermissions" };
    expect(await refusal("session.create", create)).toBe(
      "invalid_permission_update/bypass_not_allowed",
    );
    expect(await refusal("host.bypass", { allow: true })).toBe("invalid_state/bypass_confirm");
    expect((await loadConfig(file)).allowBypassPermissions).toBe(false);
    expect(await client.data("host.bypass", { allow: true, confirm: true })).toEqual({
      allowBypassPermissions: true,
    });
    expect((await loadConfig(file)).allowBypassPermissions).toBe(true);
    const info = await client.data<{ allowBypassPermissions?: boolean }>("host.info", {});
    expect(info?.allowBypassPermissions).toBe(true);
    expect(await refusal("session.create", create)).toBe("ok");
    expect(await client.data("host.bypass", { allow: false })).toEqual({
      allowBypassPermissions: false,
    });
    expect((await loadConfig(file)).allowBypassPermissions).toBe(false);
    expect(await refusal("session.create", create)).toBe(
      "invalid_permission_update/bypass_not_allowed",
    );
  });

  test("setMode still never loosens a live session to bypass while the switch is off", async () => {
    const { manager, project } = newManager({ allowBypass: () => false });
    const { sessionId } = await manager.create({
      cwd: project,
      prompt: "go",
      permissionMode: "default",
    });
    await expect(manager.setPermissionMode(sessionId, "bypassPermissions")).rejects.toThrow();
  });
});

describe("bypass-daemon: over the protocol", () => {
  test("session.setMode takes bypassPermissions only while the host switch is on", async () => {
    const { client, project, refusal } = await daemon({ allowBypassPermissions: false });
    const created = await client.data<{ sessionId: string }>("session.create", {
      cwd: project,
      prompt: "go",
      permissionMode: "default",
    });
    const sessionId = created?.sessionId ?? "";
    await Bun.sleep(100);
    const setMode = { sessionId, permissionMode: "bypassPermissions" };
    expect(await refusal("session.setMode", setMode)).toBe(
      "invalid_permission_update/mode_looser_than_start",
    );
    await client.data("host.bypass", { allow: true, confirm: true });
    expect(await refusal("session.setMode", setMode)).toBe("ok");
  });
});
