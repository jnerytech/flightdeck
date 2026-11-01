import { describe, expect, test } from "bun:test";
import { appendFileSync, cpSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { SecretScanner } from "@flightdeck/protocol";
import { EventStore } from "../src/store/event-store.ts";
import { TraceService } from "../src/trace/service.ts";
import { tempDir } from "./helpers.ts";

const SESSION = "bbbbbbbb-0000-4000-8000-000000000025";
const FIXTURES = join(import.meta.dir, "fixtures/trace");
const KEY = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";

/** The fixture session, with one more tool call whose command and result carry a token. */
function setup() {
  const db = new EventStore(":memory:").db;
  const project = join(tempDir("fd-trace-export-"), "projects", "proj");
  mkdirSync(join(project, SESSION), { recursive: true });
  const file = join(project, `${SESSION}.jsonl`);
  cpSync(join(FIXTURES, "main.jsonl"), file);
  cpSync(join(FIXTURES, "subagents"), join(project, SESSION, "subagents"), { recursive: true });
  const line = (value: object) => `${JSON.stringify(value)}\n`;
  appendFileSync(
    file,
    line({
      type: "assistant",
      uuid: "a-9",
      timestamp: "2026-11-01T12:02:00.000Z",
      message: {
        id: "msg_X",
        content: [
          {
            type: "tool_use",
            id: "toolu_x",
            name: "Bash",
            input: { command: `curl -H "Authorization: token ${KEY}" x` },
          },
        ],
      },
    }) +
      line({
        type: "user",
        uuid: "u-9",
        timestamp: "2026-11-01T12:02:03.000Z",
        message: { content: [{ type: "tool_result", tool_use_id: "toolu_x", content: "ok" }] },
      }),
  );
  db.query(
    `INSERT INTO history_sessions (claude_session_id, cwd, title, first_ts, last_ts, message_count, origin, file_path)
     VALUES (?, '/work/app', 't', '2026-11-01T12:00:00.000Z', '2026-11-01T12:02:03.000Z', 3, 'external', ?)`,
  ).run(SESSION, file);
  return new TraceService({ db, scanner: new SecretScanner() });
}

interface Node {
  id: string;
  label: string | null;
  input: string | null;
  result: string | null;
  durationMs: number | null;
  costUsd: number | null;
  inputTokens: number;
  children: Node[];
}
const flat = (nodes: Node[]): Node[] => nodes.flatMap((n) => [n, ...flat(n.children)]);
const parsed = (json: string) =>
  JSON.parse(json) as {
    format: string;
    version: number;
    includesContent: boolean;
    trace: { turns: Node[] };
  };

describe("rastro-export: structure and numbers by default", () => {
  test("no prompt, input, result or thought leaves, and the timings, costs and tokens do", () => {
    const out = setup().export(SESSION, false);
    expect(out.filename).toBe("trace-bbbbbbbb.json");
    expect(out.redacted).toBe(0);
    const file = parsed(out.json);
    expect(file).toMatchObject({ format: "flightdeck-trace", version: 1, includesContent: false });
    const nodes = flat(file.trace.turns);
    expect(nodes.every((n) => n.label === null && n.input === null && n.result === null)).toBe(
      true,
    );
    expect(nodes.find((n) => n.id === "tool:toolu_2")?.durationMs).toBe(10_000);
    expect(nodes.find((n) => n.id === "agent:a1")).toMatchObject({ inputTokens: 2_810 });
    expect(out.json).not.toContain(KEY);
    expect(out.json).not.toContain("Arrume o build");
    expect(out.json).not.toContain("bun test");
  });
});

describe("rastro-export: with the content, past the secret scan", () => {
  test("the text comes along, and a field with a secret in it is replaced and counted", () => {
    const out = setup().export(SESSION, true);
    const file = parsed(out.json);
    expect(file.includesContent).toBe(true);
    const nodes = flat(file.trace.turns);
    expect(nodes.find((n) => n.id === "turn:1")?.label).toBe("Arrume o build");
    expect(nodes.find((n) => n.id === "tool:toolu_2")?.input).toBe("bun test");
    expect(nodes.find((n) => n.id === "tool:toolu_x")?.input).toBe("[redacted: token do GitHub]");
    expect(out.redacted).toBe(1);
    expect(out.json).not.toContain(KEY);
  });
});
