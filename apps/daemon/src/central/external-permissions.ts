import type { AutoApproval, ExternalPermissionFrame, PermissionUpdate } from "@flightdeck/protocol";
import { userHome } from "../config.ts";
import type { AutoApprover } from "../permissions/auto-approve.ts";
import { checkUpdates, parseSuggestions } from "../permissions/permission-updates.ts";
import { RiskClassifier } from "../permissions/risk.ts";
import { ulid } from "../ulid.ts";
import type { HookPayload } from "./external.ts";

export type { ExternalPermissionFrame };

/** The hook's answer to an automatic approval. */
const ALLOW = JSON.stringify({
  hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } },
});

/** Longer strings are cut here: the queue shows what is asked, not whole files. */
const MAX_TEXT = 200;

/** The tool input as shown in the queue: long strings cut, everything else as is. */
export function summarizeInput(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null) return {};
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [
      key,
      typeof value === "string" && value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT)}…` : value,
    ]),
  );
}

interface Held {
  frame: ExternalPermissionFrame;
  resolve(body: string): void;
}

/**
 * PermissionRequest hooks of external sessions. Held only while some app watches (otherwise the
 * terminal decides at once); nothing is ever allowed without an explicit answer from the app.
 */
export class ExternalPermissions {
  private readonly held = new Map<string, Held>();
  private readonly watchers = new Set<(frame: ExternalPermissionFrame) => void>();

  private readonly risk: RiskClassifier;
  private readonly auto: Pick<AutoApprover, "decide"> | undefined;

  /**
   * `risk`: the classifier of the daemon's config, built-in rules alone when absent. `auto`:
   * the projects' automatic approval (phase 13).
   */
  constructor(opts: { risk?: RiskClassifier; auto?: Pick<AutoApprover, "decide"> } = {}) {
    this.risk = opts.risk ?? new RiskClassifier({ allowedRoots: [], home: userHome() });
    this.auto = opts.auto;
  }

  /**
   * Resolves with the hook's JSON answer, or "" (no decision: the terminal's dialog decides).
   * An automatic "allow" answers too, even with no app watching.
   */
  hold(payload: HookPayload, signal: AbortSignal): Promise<string> {
    const toolName = String(payload.tool_name ?? "");
    const input = { ...(payload.tool_input as Record<string, unknown> | undefined) };
    const cwd = String(payload.cwd ?? "");
    // From the whole input: the cut one could hide what comes after 200 characters.
    const risk = this.risk.classify(toolName, input, cwd);
    const requestId = `ext-${ulid()}`;
    const claudeSessionId = String(payload.session_id ?? "");
    const auto =
      this.auto?.decide({ sessionKey: claudeSessionId, requestId, toolName, input, cwd, risk }) ??
      Promise.resolve(null);
    if (this.watchers.size === 0) {
      return auto.then((decision) => (decision?.decision === "allow" ? ALLOW : ""));
    }
    const suggestions = parseSuggestions(payload.permission_suggestions);
    const frame: ExternalPermissionFrame = {
      type: "external.permission",
      requestId,
      claudeSessionId,
      toolName,
      input: summarizeInput(payload.tool_input),
      ...(suggestions.length > 0 ? { suggestions } : {}),
      risk: risk.level,
      riskReason: risk.reason,
      state: "open",
      createdAt: new Date().toISOString(),
    };
    return new Promise((resolve) => {
      this.held.set(frame.requestId, { frame, resolve });
      // Timeout of the hook or Claude gone: the connection drops.
      signal.addEventListener("abort", () => this.close(frame.requestId, "dropped", ""), {
        once: true,
      });
      this.publish(frame);
      void auto.then((decision) => {
        if (decision?.decision !== "allow") return;
        const { by, reason, model } = decision;
        this.close(requestId, "allow", ALLOW, { by, reason, model });
      });
    });
  }

  /**
   * Answers an external request; false when `requestId` is not one (a managed session's). Allowed
   * with `updatedPermissions`, the hook's decision carries them (Claude Code applies them).
   */
  respond(
    requestId: string,
    decision: "allow" | "deny",
    message?: string,
    updatedPermissions: PermissionUpdate[] = [],
  ): boolean {
    const held = this.held.get(requestId);
    if (!held) return false;
    if (decision === "allow") {
      // Refused updates leave the hook held, before anything is answered.
      const { toolName, suggestions = [] } = held.frame;
      checkUpdates(updatedPermissions, { toolName, suggestions });
    }
    const updates = updatedPermissions.length > 0 ? { updatedPermissions } : {};
    const answer =
      decision === "allow" ? { behavior: "allow", ...updates } : { behavior: "deny", message };
    const body = JSON.stringify({
      hookSpecificOutput: { hookEventName: "PermissionRequest", decision: answer },
    });
    this.close(requestId, decision, body);
    return true;
  }

  /** A later event of the session: the request was answered in the terminal. */
  closeSession(claudeSessionId: string): void {
    for (const [requestId, held] of this.held) {
      if (held.frame.claudeSessionId === claudeSessionId) {
        this.close(requestId, "answered_elsewhere", "");
      }
    }
  }

  /** The daemon is stopping: every held hook gets an empty answer. */
  closeAll(): void {
    for (const requestId of [...this.held.keys()]) this.close(requestId, "dropped", "");
  }

  open(): ExternalPermissionFrame[] {
    return [...this.held.values()].map((held) => held.frame);
  }

  /** Apps watching the queue; with none, requests are not held. */
  watch(listener: (frame: ExternalPermissionFrame) => void): () => void {
    this.watchers.add(listener);
    return () => this.watchers.delete(listener);
  }

  private close(
    requestId: string,
    resolution: NonNullable<ExternalPermissionFrame["resolution"]>,
    body: string,
    auto?: AutoApproval,
  ): void {
    const held = this.held.get(requestId);
    if (!held) return;
    this.held.delete(requestId);
    held.resolve(body);
    this.publish({ ...held.frame, state: "closed", resolution, ...(auto ? { auto } : {}) });
  }

  private publish(frame: ExternalPermissionFrame): void {
    for (const watcher of this.watchers) watcher(frame);
  }
}
