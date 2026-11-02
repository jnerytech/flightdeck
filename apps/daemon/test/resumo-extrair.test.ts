import { describe, expect, test } from "bun:test";
import { SecretScanner } from "@flightdeck/protocol";
import { buildSummary, type SummaryInput } from "../src/summary/summary.ts";

const line = (value: unknown): string => JSON.stringify(value);
const user = (content: unknown, extra: object = {}): string =>
  line({ type: "user", isSidechain: false, message: { role: "user", content }, ...extra });
const assistant = (content: unknown[], extra: object = {}): string =>
  line({
    type: "assistant",
    isSidechain: false,
    message: { role: "assistant", content },
    ...extra,
  });
const say = (text: string): unknown => ({ type: "text", text });
const tool = (name: string, input: object): unknown => ({
  type: "tool_use",
  id: `t-${name}`,
  name,
  input,
});

function run(lines: string[], over: Partial<SummaryInput> = {}) {
  return buildSummary({
    main: lines.join("\n"),
    costUsd: null,
    pending: null,
    state: "idle",
    scanner: new SecretScanner(),
    ...over,
  });
}

describe("resumo-extrair", () => {
  test("asked is the first real prompt, skipping command and system-reminder wrappers", () => {
    const summary = run([
      user("<command-name>/clear</command-name>"),
      user("<system-reminder>context</system-reminder>"),
      user([{ type: "text", text: "Fix the build" }]),
      user("Second prompt"),
    ]);
    expect(summary.asked).toBe("Fix the build");
  });

  test("done is the last assistant text and thinking blocks are not text", () => {
    const summary = run([
      user("go"),
      assistant([{ type: "thinking", thinking: "hmm" }, say("Reading the file.")]),
      assistant([say("Build fixed.")]),
      assistant([tool("Read", { file_path: "/a.ts" })]),
    ]);
    expect(summary.done).toBe("Build fixed.");
  });

  test("files come from Edit, Write and NotebookEdit, deduplicated, in order of first touch", () => {
    const summary = run([
      user("go"),
      assistant([
        tool("Edit", { file_path: "/r/a.ts" }),
        tool("Write", { file_path: "/r/b.ts" }),
        tool("Read", { file_path: "/r/read-only.ts" }),
        tool("NotebookEdit", { notebook_path: "/r/n.ipynb" }),
        tool("Edit", { file_path: "/r/a.ts" }),
      ]),
    ]);
    expect(summary.files).toEqual(["/r/a.ts", "/r/b.ts", "/r/n.ipynb"]);
    expect(summary.filesMore).toBe(0);
  });

  test("more than 12 files are capped and the rest is counted", () => {
    const edits = Array.from({ length: 15 }, (_, i) => tool("Edit", { file_path: `/r/f${i}.ts` }));
    const summary = run([user("go"), assistant(edits)]);
    expect(summary.files).toHaveLength(12);
    expect(summary.files[11]).toBe("/r/f11.ts");
    expect(summary.filesMore).toBe(3);
  });

  test("sidechain entries are ignored", () => {
    const summary = run([
      user("main prompt"),
      assistant([say("main answer"), tool("Edit", { file_path: "/r/main.ts" })]),
      user("sub prompt", { isSidechain: true }),
      assistant([say("sub answer"), tool("Edit", { file_path: "/r/sub.ts" })], {
        isSidechain: true,
      }),
    ]);
    expect(summary.asked).toBe("main prompt");
    expect(summary.done).toBe("main answer");
    expect(summary.files).toEqual(["/r/main.ts"]);
  });

  test("a user turn whose content is neither text nor a list is not a prompt", () => {
    const summary = run([user(42), user({ odd: true }), user(null), user("the real one")]);
    expect(summary.asked).toBe("the real one");
  });

  test("a tool result turn is not a prompt", () => {
    const summary = run([
      user([{ type: "tool_result", tool_use_id: "x", content: "ok" }]),
      user("the real prompt"),
    ]);
    expect(summary.asked).toBe("the real prompt");
  });

  test("an empty transcript gives null asked and done, and a corrupt line is skipped", () => {
    const empty = run([]);
    expect(empty.asked).toBeNull();
    expect(empty.done).toBeNull();
    expect(empty.files).toEqual([]);
    const corrupt = run(["{not json", user("still works"), "", "[1]"]);
    expect(corrupt.asked).toBe("still works");
  });

  test("question comes from the pending permission or question, null without one", () => {
    expect(run([user("go")]).question).toBeNull();
    const pending = { kind: "permission" as const, text: "Run `rm -rf build`?" };
    expect(run([user("go")], { pending }).question).toBe("Run `rm -rf build`?");
  });

  test("cost and state pass through", () => {
    const summary = run([user("go")], { costUsd: 1.25, state: "waiting" });
    expect(summary.costUsd).toBe(1.25);
    expect(summary.state).toBe("waiting");
    expect(summary.source).toBe("transcript");
  });
});
