import type {
  AutoApproval,
  CommandPayload,
  PermissionUpdate,
  PlainInfo,
  SessionEvent,
  ToolInput,
} from "@flightdeck/protocol";
import { FlightdeckError } from "../errors.ts";
import type { PermissionDecision } from "../runtime/types.ts";
import type { EventStore, PermissionStatus } from "../store/event-store.ts";
import { ulid } from "../ulid.ts";
import type { AutoApproveRequest, AutoDecision } from "./auto-approve.ts";
import { alwaysAsks, checkUpdates } from "./permission-updates.ts";
import type { Risk } from "./risk.ts";

export interface BrokerHooks {
  emit(sessionId: string, event: SessionEvent): void;
  /** Called whenever the number of open requests of a session changes. */
  onPendingChange(sessionId: string, pending: number): void;
  /** Phase 13: the request's risk, sent with it. */
  classify(sessionId: string, toolName: string, input: ToolInput): Risk;
  /** Phase 13: the automatic approval's decision; null without it. */
  autoDecide?(request: AutoApproveRequest): Promise<AutoDecision | null>;
  /** Phase 33: the request in plain words; the host looks at its files to word it. */
  plain?(sessionId: string, toolName: string, input: ToolInput, risk: Risk): Promise<PlainInfo>;
}

/** The `answers` of an answered AskUserQuestion, when every one is a string. */
function chosenAnswers(
  input: Record<string, unknown> | undefined,
): Record<string, string> | undefined {
  const answers = input?.answers;
  if (!answers || typeof answers !== "object") return undefined;
  const entries = Object.entries(answers);
  return entries.every(([, value]) => typeof value === "string")
    ? (answers as Record<string, string>)
    : undefined;
}

interface Pending {
  sessionId: string;
  toolName: string;
  /** What the CLI offered: the only updates, with project rules, an answer may carry. */
  suggestions: PermissionUpdate[];
  resolve: (decision: PermissionDecision) => void;
  detach: () => void;
}

/** The stored status of each way a request is answered. */
const STATUS_OF: Record<"allow" | "deny" | "cancelled", Exclude<PermissionStatus, "pending">> = {
  allow: "allowed",
  deny: "denied",
  cancelled: "cancelled",
};

/**
 * Turns `canUseTool` calls into persisted `pending` requests and resolves them when a client
 * answers, the turn is interrupted (`cancelled`) or the daemon restarts (`expired`).
 */
export class PermissionBroker {
  private readonly open = new Map<string, Pending>();

  constructor(
    private readonly store: EventStore,
    private readonly hooks: BrokerHooks,
  ) {}

  request(
    sessionId: string,
    toolName: string,
    input: ToolInput,
    signal: AbortSignal,
    offered: PermissionUpdate[] = [],
  ): Promise<PermissionDecision> {
    // A tool that always asks gets no "always allow" to pick.
    const suggestions = alwaysAsks(toolName) ? [] : offered;
    if (signal.aborted) return Promise.resolve({ behavior: "deny", message: "cancelado" });
    const id = ulid();
    this.store.createPermission({ id, sessionId, toolName, input });
    return new Promise((resolve) => {
      const onAbort = () => this.finish(id, "cancelled");
      signal.addEventListener("abort", onAbort, { once: true });
      this.open.set(id, {
        sessionId,
        toolName,
        suggestions,
        resolve,
        detach: () => signal.removeEventListener("abort", onAbort),
      });
      const risk = this.hooks.classify(sessionId, toolName, input);
      const announce = (plain?: PlainInfo) => {
        // Answered meanwhile (the turn was interrupted): nothing to announce.
        if (!this.open.has(id)) return;
        this.hooks.emit(sessionId, {
          type: "permission.requested",
          requestId: id,
          toolName,
          input,
          ...(suggestions.length > 0 ? { suggestions } : {}),
          risk: risk.level,
          riskReason: risk.reason,
          ...(plain ? { plain } : {}),
        });
        this.hooks.onPendingChange(sessionId, this.pendingCount(sessionId));
      };
      // Asked like any other request: an automatic "allow" answers it, unless you did first.
      const decide = () =>
        void this.hooks
          .autoDecide?.({ sessionKey: sessionId, requestId: id, toolName, input, cwd: "", risk })
          .then((auto) => {
            if (auto?.decision !== "allow") return;
            const { by, reason, model } = auto;
            this.finish(id, "allow", undefined, { behavior: "allow" }, { by, reason, model });
          });
      // With the plain wording the request is announced once the host has looked at its files,
      // and only then can it be answered automatically (the answer follows the question).
      if (this.hooks.plain) {
        const looked = (plain?: PlainInfo) => {
          announce(plain);
          decide();
        };
        void this.hooks.plain(sessionId, toolName, input, risk).then(looked, () => looked());
      } else {
        announce();
        decide();
      }
    });
  }

  /** The session of an open request; "" when it is not open. */
  sessionOf(requestId: string): string {
    return this.open.get(requestId)?.sessionId ?? "";
  }

  respond(payload: CommandPayload<"permission.respond">): void {
    const pending = this.open.get(payload.requestId);
    if (!pending) {
      throw new FlightdeckError(
        "not_found",
        `pedido de permissão ${payload.requestId} não está aberto`,
        "permission_request_closed",
        { id: payload.requestId },
      );
    }
    if (payload.decision === "allow") {
      // Refused updates leave the request open, before anything is applied.
      const updates = payload.updatedPermissions ?? [];
      checkUpdates(updates, pending);
      this.finish(
        payload.requestId,
        "allow",
        payload.message,
        {
          behavior: "allow",
          ...(payload.updatedInput ? { updatedInput: payload.updatedInput } : {}),
          ...(updates.length > 0 ? { updatedPermissions: updates } : {}),
        },
        undefined,
        pending.toolName === "AskUserQuestion" ? chosenAnswers(payload.updatedInput) : undefined,
      );
    } else {
      const message = payload.message ?? "Negado pelo usuário";
      this.finish(payload.requestId, "deny", message, { behavior: "deny", message });
    }
  }

  /** Cancels every open request of a session (interrupt, close, runtime failure). */
  cancelSession(sessionId: string): void {
    for (const [id, pending] of this.open) {
      if (pending.sessionId === sessionId) this.finish(id, "cancelled");
    }
  }

  /** Marks requests left `pending` by a previous daemon process as `expired`. */
  expireStale(): void {
    for (const record of this.store.pendingPermissions()) {
      if (this.open.has(record.id)) continue;
      this.store.resolvePermission(record.id, "expired");
      this.hooks.emit(record.sessionId, {
        type: "permission.resolved",
        requestId: record.id,
        decision: "expired",
      });
    }
  }

  pendingCount(sessionId: string): number {
    let count = 0;
    for (const pending of this.open.values()) if (pending.sessionId === sessionId) count++;
    return count;
  }

  private finish(
    id: string,
    decision: "allow" | "deny" | "cancelled",
    message?: string,
    result: PermissionDecision = { behavior: "deny", message: "cancelado" },
    auto?: AutoApproval,
    answers?: Record<string, string>,
  ): void {
    const pending = this.open.get(id);
    if (!pending) return;
    this.open.delete(id);
    pending.detach();
    const status = STATUS_OF[decision];
    this.store.resolvePermission(id, status, message);
    this.hooks.emit(pending.sessionId, {
      type: "permission.resolved",
      requestId: id,
      decision,
      ...(message !== undefined ? { message } : {}),
      ...(auto ? { auto } : {}),
      ...(answers ? { answers } : {}),
    });
    this.hooks.onPendingChange(pending.sessionId, this.pendingCount(pending.sessionId));
    pending.resolve(result);
  }
}
