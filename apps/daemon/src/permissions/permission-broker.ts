import type { CommandPayload, SessionEvent, ToolInput } from "@flightdeck/protocol";
import { FlightdeckError } from "../errors.ts";
import type { PermissionDecision } from "../runtime/types.ts";
import type { EventStore } from "../store/event-store.ts";
import { ulid } from "../ulid.ts";

export interface BrokerHooks {
  emit(sessionId: string, event: SessionEvent): void;
  /** Called whenever the number of open requests of a session changes. */
  onPendingChange(sessionId: string, pending: number): void;
}

interface Pending {
  sessionId: string;
  resolve: (decision: PermissionDecision) => void;
  detach: () => void;
}

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
  ): Promise<PermissionDecision> {
    if (signal.aborted) return Promise.resolve({ behavior: "deny", message: "cancelado" });
    const id = ulid();
    this.store.createPermission({ id, sessionId, toolName, input });
    return new Promise((resolve) => {
      const onAbort = () => this.finish(id, "cancelled");
      signal.addEventListener("abort", onAbort, { once: true });
      this.open.set(id, {
        sessionId,
        resolve,
        detach: () => signal.removeEventListener("abort", onAbort),
      });
      this.hooks.emit(sessionId, { type: "permission.requested", requestId: id, toolName, input });
      this.hooks.onPendingChange(sessionId, this.pendingCount(sessionId));
    });
  }

  respond(payload: CommandPayload<"permission.respond">): void {
    if (!this.open.has(payload.requestId)) {
      throw new FlightdeckError(
        "not_found",
        `pedido de permissão ${payload.requestId} não está aberto`,
      );
    }
    if (payload.decision === "allow") {
      this.finish(payload.requestId, "allow", payload.message, {
        behavior: "allow",
        ...(payload.updatedInput ? { updatedInput: payload.updatedInput } : {}),
      });
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
  ): void {
    const pending = this.open.get(id);
    if (!pending) return;
    this.open.delete(id);
    pending.detach();
    const status = decision === "allow" ? "allowed" : decision === "deny" ? "denied" : "cancelled";
    this.store.resolvePermission(id, status, message);
    this.hooks.emit(pending.sessionId, {
      type: "permission.resolved",
      requestId: id,
      decision,
      ...(message !== undefined ? { message } : {}),
    });
    this.hooks.onPendingChange(pending.sessionId, this.pendingCount(pending.sessionId));
    pending.resolve(result);
  }
}
