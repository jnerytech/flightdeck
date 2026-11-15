import { describe, expect, test } from "bun:test";
import { runDoctor } from "../../src/deps/domain/doctor.ts";
import { flightdeckMcpServer } from "../../src/runtime/domain/flightdeck-mcp.ts";
import { startedWith } from "../support/mcp-sessions.ts";

describe("mcp-sessoes", () => {
  test("the command is this daemon's binary running mcp with its config file", () => {
    expect(flightdeckMcpServer(["/opt/fd/flightdeckd"], "/home/u/config.json")).toEqual({
      command: "/opt/fd/flightdeckd",
      args: ["mcp", "--config", "/home/u/config.json"],
    });
    expect(flightdeckMcpServer(["/usr/bin/bun", "run", "/src/main.ts"], "/c.json")).toEqual({
      command: "/usr/bin/bun",
      args: ["run", "/src/main.ts", "mcp", "--config", "/c.json"],
    });
  });

  test("a managed session gets the flightdeck MCP server, with its own session id", () => {
    const options = startedWith({ command: "/fd", args: ["mcp"] }, "default");
    expect(options.mcpServers).toEqual({
      flightdeck: {
        type: "stdio",
        command: "/fd",
        args: ["mcp"],
        env: { FLIGHTDECK_SESSION: "s1" },
      },
    });
  });

  test("a session that carries no id still gets the server, with no environment of its own", () => {
    const options = startedWith({ command: "/fd", args: ["mcp"] }, "default", null);
    expect(options.mcpServers).toEqual({
      flightdeck: { type: "stdio", command: "/fd", args: ["mcp"] },
    });
  });

  test("it adds to the user and project servers: their settings still load and nothing is made exclusive", () => {
    const options = startedWith({ command: "/fd", args: ["mcp"] }, "default");
    expect(options.settingSources).toEqual(["user", "project", "local"]);
    expect(Object.keys(options.mcpServers ?? {})).toEqual(["flightdeck"]);
    expect(options.strictMcpConfig).toBeUndefined();
  });

  test("the permission mode the session was started with is kept, plan is not forced", () => {
    expect(startedWith({ command: "/fd", args: ["mcp"] }, "acceptEdits").permissionMode).toBe(
      "acceptEdits",
    );
    expect(startedWith({ command: "/fd", args: ["mcp"] }, "default").permissionMode).toBe(
      "default",
    );
  });

  test("a runtime without the server option sends none", () => {
    expect(startedWith(undefined, "default").mcpServers).toBeUndefined();
  });

  test("doctor: the MCP server of sessions starts, or says the one line that fixes it", async () => {
    const base = {
      config: () => ({ bind: "127.0.0.1", port: 7777, allowedRoots: ["/code"] }),
      isDirectory: () => true,
      serviceInstalled: async () => true,
      healthy: async () => true,
      tailscaleIp: async () => null,
      hooks: () => "installed" as const,
      claudePath: () => "/usr/bin/claude",
    };
    const ok = await runDoctor({ ...base, mcp: async () => ({ command: "/fd", exists: true }) });
    expect(ok.checks.find((c) => c.id === "mcp")).toMatchObject({ status: "ok" });
    const missing = await runDoctor({
      ...base,
      mcp: async () => ({ command: "/gone/flightdeckd", exists: false }),
    });
    expect(missing.checks.find((c) => c.id === "mcp")).toMatchObject({
      status: "warn",
      fix: "run: flightdeckd setup",
    });
    expect(missing.checks.find((c) => c.id === "mcp")?.detail).toContain("/gone/flightdeckd");
  });
});
