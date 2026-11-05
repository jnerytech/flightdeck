import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RiskClassifier } from "../src/permissions/risk.ts";
import { mapOpenCodeTool } from "../src/runtime/opencode-tools.ts";

const FIXTURES = join(import.meta.dir, "fixtures", "opencode-acp");

/** The `toolCall`s of the recorded permission requests, by name. */
function recordedRequests(file: string): Map<string, Record<string, unknown>> {
  const out = new Map<string, Record<string, unknown>>();
  for (const line of readFileSync(join(FIXTURES, file), "utf8").trim().split("\n")) {
    const { msg } = JSON.parse(line) as {
      msg: {
        method?: string;
        params?: { toolCall?: { name: string; rawInput: Record<string, unknown> } };
      };
    };
    if (msg.method === "session/request_permission" && msg.params?.toolCall) {
      out.set(msg.params.toolCall.name, msg.params.toolCall.rawInput);
    }
  }
  return out;
}

describe("opencode-tools", () => {
  test("the recorded requests map to Claude's names and fields", () => {
    const requests = recordedRequests("tools.jsonl");
    const map = (name: string) => mapOpenCodeTool(name, requests.get(name) ?? {});
    expect(map("shell")).toEqual({
      name: "Bash",
      input: { command: "echo fixture-ok", cwd: "/work/project" },
    });
    expect(map("write")).toEqual({
      name: "Write",
      input: { file_path: "/work/project/notes.txt", content: "hi there\n" },
    });
    expect(map("edit")).toEqual({
      name: "Edit",
      input: {
        file_path: "/work/project/notes.txt",
        old_string: "hi there",
        new_string: "hello there",
      },
    });
    expect(map("webfetch")).toEqual({ name: "WebFetch", input: { url: "https://example.com" } });
  });

  test("read, glob, grep, websearch and a description keep their fields under Claude's names", () => {
    expect(mapOpenCodeTool("read", { path: "/w/a.ts", offset: 3 })).toEqual({
      name: "Read",
      input: { file_path: "/w/a.ts", offset: 3 },
    });
    expect(mapOpenCodeTool("glob", { pattern: "*.ts", path: "/w" })).toEqual({
      name: "Glob",
      input: { pattern: "*.ts", path: "/w" },
    });
    expect(mapOpenCodeTool("grep", { pattern: "x" })).toEqual({
      name: "Grep",
      input: { pattern: "x" },
    });
    expect(mapOpenCodeTool("websearch", { query: "bun" })).toEqual({
      name: "WebSearch",
      input: { query: "bun" },
    });
    expect(mapOpenCodeTool("shell", { command: "ls", description: "list", cwd: "/w" })).toEqual({
      name: "Bash",
      input: { command: "ls", description: "list", cwd: "/w" },
    });
    expect(
      mapOpenCodeTool("edit", { path: "/w/a", oldString: "a", newString: "b", replaceAll: true }),
    ).toEqual({
      name: "Edit",
      input: { file_path: "/w/a", old_string: "a", new_string: "b", replace_all: true },
    });
  });

  test("the Flightdeck MCP tools take the mcp__flightdeck__ name; anything else is opencode:<name>", () => {
    expect(mapOpenCodeTool("flightdeck_run_with_secret", { command: "x" })).toEqual({
      name: "mcp__flightdeck__run_with_secret",
      input: { command: "x" },
    });
    const subagent = recordedRequests("child.jsonl").get("subagent") ?? {};
    expect(mapOpenCodeTool("subagent", subagent).name).toBe("opencode:subagent");
    expect(mapOpenCodeTool("execute", { code: "1" })).toEqual({
      name: "opencode:execute",
      input: { code: "1" },
    });
    expect(mapOpenCodeTool("context7_resolve", {}).name).toBe("opencode:context7_resolve");
  });

  test("the risk rules: opencode:* is high and network; writes or commands naming the global OpenCode folder are high", () => {
    const risk = new RiskClassifier({ allowedRoots: [], home: "/home/u" });
    expect(risk.classify("opencode:execute", { code: "1" }, "/w")).toEqual({
      level: "high",
      reason: "an OpenCode tool Flightdeck does not know",
      network: true,
    });
    const plugin = risk.classify(
      "Write",
      { file_path: "/home/u/.config/opencode/plugins/x.ts" },
      "/home/u",
    );
    expect([plugin.level, plugin.reason]).toEqual(["high", "writes OpenCode's configuration"]);
    const shell = risk.classify("Bash", { command: "cp x.ts ~/.config/opencode/plugins/" }, "/w");
    expect([shell.level, shell.reason]).toEqual(["high", "writes OpenCode's configuration"]);
    // A Bash command from the fixture, inside the folder, keeps the ordinary rules.
    expect(risk.classify("Bash", { command: "echo fixture-ok", cwd: "/w" }, "/w").level).toBe(
      "medium",
    );
  });
});
