import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tauriPlatform } from "../src/platform/tauri/index.ts";

const rust = readFileSync(join(import.meta.dir, "../src-tauri/src/lib.rs"), "utf8");

describe("log-tauri: the shell's log file (issue #255)", () => {
  test("the platform's log writes, reads and opens through the shell's own commands", async () => {
    const invokes: Array<[string, unknown]> = [];
    const call = (async (cmd: string, args?: unknown) => {
      invokes.push([cmd, args]);
      return cmd === "read_log_tail" ? ["a", "b"] : undefined;
    }) as never;
    const platform = tauriPlatform({} as never, call);
    await platform.logs?.write("2026 INFO hello");
    expect(await platform.logs?.tail(50)).toEqual(["a", "b"]);
    await platform.logs?.openFolder();
    expect(invokes).toEqual([
      ["append_log", { line: "2026 INFO hello" }],
      ["read_log_tail", { lines: 50 }],
      ["open_logs_dir", undefined],
    ]);
  });

  test("the commands exist, are registered, and take no path from the webview", () => {
    for (const name of ["append_log", "read_log_tail", "open_logs_dir"]) {
      expect(rust).toContain(`fn ${name}(`);
      expect(rust).toMatch(new RegExp(`\\b${name},?\\s*\\n`));
    }
    // The folder is the app's own log dir: no command carries a path.
    const signature = (name: string) => new RegExp(`fn ${name}\\(([^)]*)\\)`).exec(rust)?.[1] ?? "";
    for (const name of ["append_log", "read_log_tail", "open_logs_dir"]) {
      expect(signature(name)).not.toMatch(/path|dir|file/i);
    }
    expect(rust).toContain("app_log_dir()");
  });

  test("the file rotates at 5 MB across 5 files, and a line is one line of bounded size", () => {
    expect(rust).toMatch(/const LOG_MAX_BYTES: u64 = 5 \* 1024 \* 1024;/);
    expect(rust).toMatch(/const LOG_FILES: usize = 5;/);
    expect(rust).toMatch(/const LOG_MAX_LINE: usize = \d+;/);
    expect(rust).toContain("fn rotate_logs(");
    expect(rust).toContain("fn append_line(");
    expect(rust).toContain("fn tail_lines(");
    // New lines in what the webview sends are flattened, so one call is one line.
    expect(rust).toMatch(/replace\(\['\\r', '\\n'\], " "\)/);
    // The Rust side has its own tests for the rotation and the tail.
    expect(rust).toContain("mod log_tests");
  });

  test("opening the folder goes through the opener plugin on a folder the shell made, and the webview still cannot open paths", () => {
    expect(rust).toMatch(/fn open_logs_dir[\s\S]{0,800}open_path\(/);
    const capability = readFileSync(
      join(import.meta.dir, "../src-tauri/capabilities/default.json"),
      "utf8",
    );
    expect(capability).not.toContain("opener:allow-open-path");
  });

  test("the webview reports its own errors through the log, wired in the entry point", () => {
    const entry = readFileSync(join(import.meta.dir, "../src/main.tsx"), "utf8");
    expect(entry).toContain("installGlobalLog");
    expect(entry).toContain("store.appLog");
  });

  test("the review's guards are in the Rust: one writer at a time, a failed rotation does not stop the log, a bad file is read lossily, a flood is cut before it is copied", () => {
    // M1: appends take a lock, and a poisoned one cannot turn into a panic.
    expect(rust).toMatch(/static LOG_LOCK: std::sync::Mutex<\(\)>/);
    expect(rust).toContain("PoisonError::into_inner");
    // L1: a rotation that fails still lets the line be written (up to a hard limit).
    expect(rust).toContain("LOG_HARD_LIMIT");
    // L2: at least one file.
    expect(rust).toMatch(/let files = files\.max\(1\)/);
    // L3: a file with invalid UTF-8 is read lossily, not skipped.
    expect(rust).toContain("from_utf8_lossy");
    // L4: the line is cut before the copy that flattens it.
    const body = /fn append_line\([\s\S]*?\n\}\n/.exec(rust)?.[0] ?? "";
    expect(body.indexOf("truncate")).toBeGreaterThan(-1);
    expect(body.indexOf("truncate")).toBeLessThan(body.indexOf("replace(["));
  });

  test("the Rust tests cross a boundary that needs the loop, cross files, reach the cap and clean up", () => {
    const tests = /mod log_tests[\s\S]*$/.exec(rust)?.[0] ?? "";
    expect(tests).toContain('"€".repeat(');
    expect(tests).toContain("tail_lines(&dir, 14, 4)");
    expect(tests).toContain("LOG_MAX_TAIL);");
    expect(tests).toMatch(/assert_eq!\(tail_lines\(&dir, 100_000, 4\)\.len\(\), LOG_MAX_TAIL\)/);
    expect(tests).toContain("remove_dir_all");
    expect(tests).toContain('append_line(&dir, "only", 10, 1)');
  });
});
