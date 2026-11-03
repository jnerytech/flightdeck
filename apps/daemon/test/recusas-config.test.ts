import { describe, expect, test } from "bun:test";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { AgentConfig } from "../src/agentcfg/files.ts";
import { MASK, McpConfig } from "../src/agentcfg/mcp.ts";
import { Forker } from "../src/checkpoints/fork.ts";
import { Rewinder } from "../src/checkpoints/rewind.ts";
import { Snapshots } from "../src/checkpoints/snapshots.ts";
import { FlightdeckError } from "../src/errors.ts";
import { EventStore } from "../src/store/event-store.ts";
import { tempDir } from "./helpers.ts";

/** The code, reason and params of the refusal a call ends in; the detail is English, for logs. */
async function refused(call: () => unknown) {
  try {
    await call();
  } catch (error) {
    expect(error).toBeInstanceOf(FlightdeckError);
    const { code, reason, params, message } = error as FlightdeckError;
    expect(message).not.toMatch(/[ãõçáéíóú]/);
    return { code, reason, params };
  }
  throw new Error("it did not refuse");
}

function put(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

const AGENT = "---\nname: revisor\ndescription: reviews\n---\nBody.\n";
const write = (content: string, expectedHash: string | null, path = ".claude/agents/novo.md") => ({
  kind: "agent" as const,
  path,
  content,
  expectedHash,
  confirm: true,
});

describe("recusas-config: the agent files", () => {
  const setup = () => {
    const project = tempDir("fd-agentcfg-");
    const claudeDir = tempDir("fd-claude-");
    return { project, config: new AgentConfig({ claudeDir }) };
  };

  test("a file that is not there, a path that leaves its root or has the wrong shape", async () => {
    const { project, config } = setup();
    expect(await refused(() => config.read(project, "agent", ".claude/agents/x.md"))).toEqual({
      code: "not_found",
      reason: "agentcfg_file_missing",
      params: { path: ".claude/agents/x.md" },
    });
    expect(await refused(() => config.read(project, "agent", "../x.md"))).toEqual({
      code: "bad_request",
      reason: "agentcfg_path_invalid",
      params: { kind: "agent", path: "../x.md" },
    });
  });

  test("writing needs confirm, never writes the user's folder, and a folder linked outside is refused", async () => {
    const { project, config } = setup();
    expect(
      await refused(() => config.write(project, { ...write(AGENT, null), confirm: false })),
    ).toEqual({
      code: "invalid_state",
      reason: "agentcfg_confirm",
      params: undefined,
    });
    expect(
      await refused(() => config.write(project, { ...write(AGENT, null), origin: "user" })),
    ).toEqual({ code: "invalid_state", reason: "agentcfg_user_readonly", params: undefined });
    const outside = tempDir("fd-outside-");
    mkdirSync(join(project, ".claude"));
    symlinkSync(outside, join(project, ".claude", "agents"));
    expect(await refused(() => config.write(project, write(AGENT, null)))).toEqual({
      code: "bad_request",
      reason: "agentcfg_outside_project",
      params: { path: ".claude/agents/novo.md" },
    });
  });

  test("a file that exists, or changed since it was opened, is a conflict", async () => {
    const { project, config } = setup();
    put(project, ".claude/agents/novo.md", AGENT);
    expect(await refused(() => config.write(project, write(AGENT, null)))).toEqual({
      code: "invalid_state",
      reason: "agentcfg_exists",
      params: { path: ".claude/agents/novo.md" },
    });
    expect(await refused(() => config.write(project, write(AGENT, "0".repeat(64))))).toEqual({
      code: "invalid_state",
      reason: "agentcfg_changed",
      params: { path: ".claude/agents/novo.md" },
    });
  });

  test("a frontmatter that is missing or wrong says which part", async () => {
    const { project, config } = setup();
    const refuse = (content: string) => refused(() => config.write(project, write(content, null)));
    expect((await refuse("no frontmatter\n")).reason).toBe("agentcfg_frontmatter_missing");
    expect(await refuse("---\ndescription: d\n---\n")).toEqual({
      code: "bad_request",
      reason: "agentcfg_field_required",
      params: { field: "name" },
    });
    expect((await refuse("---\nname: n\n---\n")).params).toEqual({ field: "description" });
    expect((await refuse("---\nname: n\ndescription: d\ntools: 3\n---\n")).reason).toBe(
      "agentcfg_tools_type",
    );
    expect((await refuse("---\nname: n\ndescription: d\nmodel: 3\n---\n")).reason).toBe(
      "agentcfg_model_type",
    );
  });
});

describe("recusas-config: the MCP servers", () => {
  const setup = (timeoutMs?: number) => {
    const project = tempDir("fd-mcp-");
    writeFileSync(
      join(project, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          eco: { command: process.execPath, args: ["-e", "setTimeout(() => {}, 5000)"] },
        },
      }),
    );
    const userConfigPath = join(tempDir("fd-user-"), ".claude.json");
    writeFileSync(
      userConfigPath,
      JSON.stringify({ mcpServers: { remoto: { type: "http", url: "https://mcp.example.com" } } }),
    );
    return {
      project,
      config: new McpConfig({ userConfigPath, ...(timeoutMs ? { timeoutMs } : {}) }),
    };
  };

  test("saving, removing and toggling need confirm, each with its own reason", async () => {
    const { project, config } = setup();
    const server = { name: "eco", command: "x" };
    expect((await refused(() => config.save(project, server, false))).reason).toBe(
      "mcp_write_confirm",
    );
    expect((await refused(() => config.remove(project, "eco", false))).reason).toBe(
      "mcp_remove_confirm",
    );
    expect((await refused(() => config.toggle(project, "eco", true, false))).reason).toBe(
      "mcp_toggle_confirm",
    );
  });

  test("masked values, a server that is not there, and one the user's file owns", async () => {
    const { project, config } = setup();
    expect(
      await refused(() =>
        config.save(project, { name: "eco", command: "x", env: { TOKEN: MASK } }, true),
      ),
    ).toMatchObject({ code: "invalid_state", reason: "mcp_masked_values" });
    expect(await refused(() => config.remove(project, "nada", true))).toEqual({
      code: "not_found",
      reason: "mcp_server_missing",
      params: { name: "nada" },
    });
    expect(await refused(() => config.test(project, "nada", true))).toEqual({
      code: "not_found",
      reason: "mcp_server_missing",
      params: { name: "nada" },
    });
    expect(await refused(() => config.remove(project, "remoto", true))).toEqual({
      code: "invalid_state",
      reason: "mcp_server_external",
      params: { name: "remoto" },
    });
  });

  test("a server that does not answer in time is refused with the seconds", async () => {
    const { project, config } = setup(300);
    expect(await refused(() => config.test(project, "eco", true))).toEqual({
      code: "invalid_state",
      reason: "mcp_timeout",
      params: { name: "eco", seconds: 0.3 },
    });
  });
});

describe("recusas-config: going back", () => {
  const row = { n: 1, kind: "before", repo: "/repo" };
  const rewinder = (over: { list?: unknown[]; busy?: boolean; take?: unknown } = {}) =>
    new Rewinder({
      snapshots: {
        list: () => over.list ?? [],
        take: async () => over.take ?? { skipped: "no repo" },
      },
      sessions: { busy: () => over.busy ?? false },
    } as never);

  test("nothing to undo, no confirm, a running session, a turn without a snapshot", async () => {
    expect(await refused(() => rewinder().undo("c", true))).toEqual({
      code: "not_found",
      reason: "rewind_nothing",
      params: undefined,
    });
    expect((await refused(() => rewinder().apply("c", 1, false))).reason).toBe("rewind_confirm");
    expect((await refused(() => rewinder({ busy: true }).apply("c", 1, true))).reason).toBe(
      "rewind_turn_running",
    );
    expect(await refused(() => rewinder().apply("c", 9, true))).toEqual({
      code: "not_found",
      reason: "snapshot_missing",
      params: { n: 9 },
    });
  });

  test("a safety snapshot that was skipped stops the rewind and says why", async () => {
    expect(await refused(() => rewinder({ list: [row] }).apply("c", 1, true))).toEqual({
      code: "invalid_state",
      reason: "rewind_no_safety_snapshot",
      params: { why: "no repo" },
    });
  });

  test("the files of a turn without a snapshot, and a runtime that cannot fork", async () => {
    const snapshots = new Snapshots({ db: new EventStore(":memory:").db });
    expect(await refused(() => snapshots.files("c", 4))).toEqual({
      code: "not_found",
      reason: "snapshot_missing",
      params: { n: 4 },
    });
    const forker = new Forker({ runtime: {}, manager: {} } as never);
    expect(await refused(() => forker.fork({ claudeSessionId: "c" } as never))).toEqual({
      code: "invalid_state",
      reason: "fork_unsupported",
      params: undefined,
    });
  });
});
