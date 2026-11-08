#!/usr/bin/env bun
/**
 * SessionStart (startup|resume|compact): adds the session's branch, TDD state and slot to its
 * context, a red main with its claim (#1246), and after a compact a note that the path rules come
 * back only with a matching file.
 * The text comes from scripts/lib/session-context.ts, with its tests. Any error adds nothing.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mainRedLine } from "../../scripts/lib/main-red.ts";
import { gatherFacts, sessionContext } from "../../scripts/lib/session-context.ts";

try {
  const input = await Bun.stdin.json().catch(() => null);
  const cwd = typeof input?.cwd === "string" ? input.cwd : process.cwd();
  const source = typeof input?.source === "string" ? input.source : "startup";
  let lock: string | null = null;
  try {
    lock = readFileSync(join(tmpdir(), "flightdeck-slot.lock"), "utf8");
    // A lock whose process is gone is stale: the next slot run takes it, so the slot is free.
    process.kill(Number(JSON.parse(lock).pid), 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EPERM") lock = null;
  }
  const git = (args: string[]) => {
    const proc = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 2000 });
    return proc.status === 0 ? proc.stdout : null;
  };
  // #1246: a red main and its claim; 3 s per gh call, and nothing is said when gh cannot answer.
  const gh = async (args: string[]) => {
    const proc = spawnSync("gh", args, { cwd, encoding: "utf8", timeout: 3000 });
    return { code: proc.status ?? 1, stdout: proc.stdout ?? "", stderr: proc.stderr ?? "" };
  };
  const mainRed = await mainRedLine({ gh });
  const text = sessionContext(source, { ...gatherFacts(git, lock, Date.now()), mainRed });
  if (text) {
    console.log(
      JSON.stringify({
        hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: text },
      }),
    );
  }
} catch {
  // The context is a convenience; a session never fails to start because of it.
}
process.exit(0);
