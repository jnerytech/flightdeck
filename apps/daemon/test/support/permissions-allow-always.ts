import type { PermissionUpdate } from "@flightdeck/protocol";
import type { PathKind } from "../../src/permissions/domain/rule-risk.ts";
import { newManager, poll, record } from "./helpers.ts";

export const cleanups: Array<() => unknown> = [];
export async function runCleanups() {
  for (const fn of cleanups.splice(0).reverse()) await fn();
}

/** A managed session asking for a permission (`[tool]` Write or `[bash]` Bash). */
export async function asking(prompt: string) {
  const ctx = newManager();
  const { sessionId } = await ctx.manager.create({ cwd: ctx.project, prompt });
  const events = record(ctx.manager, sessionId);
  cleanups.push(() => events.unsubscribe());
  const requested = await poll(() => events.find("permission.requested")[0], 3000);
  const requestId = requested?.requestId ?? "";
  const respond = (updatedPermissions: unknown[], kind?: PathKind) =>
    ctx.manager.respondPermission(
      {
        requestId,
        decision: "allow",
        updatedPermissions: updatedPermissions as PermissionUpdate[],
      },
      kind ? { kind } : undefined,
    );
  /** The tool result the runtime reports once allowed. */
  const result = () => poll(() => events.find("tool.result")[0], 3000);
  const open = () => ctx.store.pendingPermissions(sessionId).length;
  return { ...ctx, sessionId, events, requested, requestId, respond, result, open };
}
