import { describe, expect, test } from "bun:test";
import { FlightdeckError } from "../src/errors.ts";
import { Names } from "../src/names/names.ts";
import { checkUpdates } from "../src/permissions/permission-updates.ts";
import { EventStore } from "../src/store/event-store.ts";
import { TerminalManager } from "../src/terminal/terminal-manager.ts";
import { assetKey, DaemonUpdater } from "../src/updates/apply.ts";
import { tempDir, workspace } from "./helpers.ts";
import { fakePtys } from "./pty-helpers.ts";

/** The code, reason and params of the refusal a call ends in. */
async function refused(call: () => unknown) {
  try {
    await call();
  } catch (error) {
    expect(error).toBeInstanceOf(FlightdeckError);
    const { code, reason, params } = error as FlightdeckError;
    return { code, reason, params };
  }
  throw new Error("it did not refuse");
}

describe("recusas-gestao: session names", () => {
  test("a blank name, and a session with no name", async () => {
    const names = new Names(new EventStore(":memory:").db);
    names.assign("s-1", { project: "app" });
    expect(await refused(() => names.rename("s-1", "   "))).toEqual({
      code: "bad_request",
      reason: "name_blank",
      params: undefined,
    });
    expect(await refused(() => names.rename("nope", "x"))).toEqual({
      code: "not_found",
      reason: "session_unnamed",
      params: { id: "nope" },
    });
  });
});

describe("recusas-gestao: the terminal", () => {
  const manager = (over: Record<string, unknown> = {}) => {
    const { root } = workspace();
    const ptys = fakePtys();
    const terminals = new TerminalManager({
      pty: ptys.factory,
      allowedRoots: [root],
      enabled: true,
      platform: "linux",
      env: () => ({ SHELL: "/bin/zsh" }),
      log: () => {},
      ...over,
    });
    return { terminals, root, ptys };
  };

  test("off, missing, ended, over the limit, and no Claude here", async () => {
    const off = manager({ enabled: false });
    expect(await refused(() => off.terminals.open({ cwd: off.root }))).toEqual({
      code: "terminal_disabled",
      reason: "terminal_disabled",
      params: undefined,
    });
    const { terminals, root, ptys } = manager({ max: 1 });
    expect(await refused(() => terminals.write("nope", "x"))).toEqual({
      code: "not_found",
      reason: "terminal_missing",
      params: { id: "nope" },
    });
    const first = await terminals.open({ cwd: root });
    expect(await refused(() => terminals.open({ cwd: root }))).toEqual({
      code: "invalid_state",
      reason: "terminal_limit",
      params: { max: 1 },
    });
    expect(await refused(() => terminals.open({ cwd: root, claude: {} }))).toMatchObject({
      reason: "terminal_limit",
    });
    ptys.spawned[0]?.exit(0);
    expect(await refused(() => terminals.write(first.terminalId, "x"))).toEqual({
      code: "invalid_state",
      reason: "terminal_ended",
      params: { id: first.terminalId },
    });
    const free = manager();
    expect(await refused(() => free.terminals.open({ cwd: free.root, claude: {} }))).toEqual({
      code: "invalid_state",
      reason: "claude_here_unavailable",
      params: undefined,
    });
  });

  test("a shell that cannot start says why", async () => {
    const { terminals, root } = manager({
      pty: () => {
        throw new Error("spawn failed");
      },
    });
    expect(await refused(() => terminals.open({ cwd: root }))).toEqual({
      code: "invalid_state",
      reason: "terminal_open_failed",
      params: { why: "spawn failed" },
    });
  });
});

describe("recusas-gestao: updating the daemon", () => {
  test("a platform with no binary", async () => {
    expect(await refused(() => assetKey("freebsd", "x64"))).toEqual({
      code: "invalid_state",
      reason: "update_no_binary",
      params: { platform: "freebsd", arch: "x64" },
    });
  });

  test("no confirm, no manifest checked yet, and a manifest with no binary for this host", async () => {
    const make = (manifest: unknown) =>
      new DaemonUpdater({
        manifest: () => manifest as never,
        dataDir: tempDir(),
        ctx: {} as never,
        platform: "linux",
        arch: "x64",
      });
    expect((await refused(() => make(null).apply(false))).reason).toBe("update_confirm");
    expect(await refused(() => make(null).apply(true))).toMatchObject({
      reason: "update_manifest_unchecked",
    });
    expect(await refused(() => make({ version: "9.9.9", assets: {} }).apply(true))).toEqual({
      code: "invalid_state",
      reason: "update_manifest_no_binary",
      params: { version: "9.9.9", key: "linux-x64" },
    });
  });
});

describe("recusas-gestao: permission updates", () => {
  const rule = (over: Record<string, unknown> = {}) => ({
    type: "addRules" as const,
    rules: [{ toolName: "Bash", ruleContent: "ls" }],
    behavior: "allow" as const,
    destination: "localSettings" as const,
    ...over,
  });
  const check = (update: unknown, toolName = "Bash") =>
    refused(() => checkUpdates([update as never], { toolName, suggestions: [] }));

  test("each way an update is refused has its own reason", async () => {
    expect(await check(rule({ rules: [{ toolName: "Read" }] }))).toEqual({
      code: "invalid_permission_update",
      reason: "perm_rule_other_tool",
      params: { tool: "Read" },
    });
    expect((await check(rule({ rules: [{ toolName: "Bash", ruleContent: "a\nb" }] }))).reason).toBe(
      "perm_rule_content_invalid",
    );
    expect(await check(rule({ destination: "userSettings" }))).toEqual({
      code: "invalid_permission_update",
      reason: "perm_destination_denied",
      params: { destination: "userSettings" },
    });
    expect(
      await check({ type: "setMode", mode: "bypassPermissions", destination: "session" }),
    ).toEqual({
      code: "invalid_permission_update",
      reason: "perm_mode_denied",
      params: { mode: "bypassPermissions" },
    });
    expect((await check(rule({ rules: [{ toolName: "mcp__x__finish_card" }] }))).reason).toBe(
      "perm_tool_always_asks",
    );
    expect(
      (await check({ type: "addDirectories", directories: ["/x"], destination: "session" })).reason,
    ).toBe("perm_not_suggested");
  });
});
