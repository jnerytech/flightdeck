/**
 * Appends one hook call to the repository's hook log (`bun run harness:stats`). The rules live in
 * scripts/lib/hook-log.ts, with their tests. Logging never fails a hook: any error is swallowed.
 */
import { appendFileSync, existsSync, renameSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { appendHookLog, type HookLogEntry, hookLogPath } from "../../scripts/lib/hook-log.ts";

export function logHook(
  hook: string,
  rule: string | null,
  decision: HookLogEntry["decision"] = rule ? "block" : "allow",
): void {
  try {
    const path = hookLogPath(process.env.CLAUDE_PROJECT_DIR ?? resolve(import.meta.dir, "../.."));
    if (!path) return;
    appendHookLog(
      path,
      {
        t: new Date().toISOString(),
        hook,
        rule,
        decision,
        ms: Math.round(performance.now()),
      },
      {
        size: (p) => (existsSync(p) ? statSync(p).size : 0),
        append: (p, text) => appendFileSync(p, text),
        rename: renameSync,
      },
    );
  } catch {
    // The log is for measuring; a hook never fails because of it.
  }
}
