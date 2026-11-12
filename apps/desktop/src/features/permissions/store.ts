import type { RiskLevel } from "@flightdeck/protocol";
import type { VaultAnswer } from "@/features/vault/index.ts";
import type { T } from "../../i18n/index.ts";
import type { Answer, AppState, PendingItem } from "../../lib/app-store.ts";
import { endMeasure, startMeasure } from "../../lib/measures.ts";

/** The `permission.respond` request of an answer: only what the person gave goes in, and `held` rides on an allow only. */
function permissionResponse(requestId: string, decision: "allow" | "deny", answer: Answer) {
  const { updatedPermissions, message, updatedInput, held } = answer;
  return {
    requestId,
    decision,
    ...(updatedPermissions ? { updatedPermissions } : {}),
    ...(message ? { message } : {}),
    ...(updatedInput ? { updatedInput } : {}),
    ...(decision === "allow" && held ? { held: true } : {}),
  };
}

type PermissionResponse = ReturnType<typeof permissionResponse>;

/** What answering a request reads and asks through the app's store. */
export interface PermissionsCore {
  /** The requests waiting for an answer, worded in the current language. */
  needsYou(): PendingItem[];
  sessions(): AppState["sessions"];
  /** The host of the session open in the window, if any. */
  selectedHostId(): string | undefined;
  /** A request of the vault is answered in its own queue: true when it was one. */
  settleVault(requestId: string, answer: VaultAnswer | null): boolean;
  /** Sends the answer on a host's connection; nothing when the host is not connected. */
  sendOn(hostId: string, response: PermissionResponse): Promise<unknown> | undefined;
  /** Sends the answer on the open session's host; a refusal goes to the banner. */
  sendSelected(response: PermissionResponse): Promise<void>;
  fail(error: unknown, text?: string): void;
  t(): T;
}

/**
 * Answering a permission request (#245, #1596: a slice of the store): from the "needs you" queue
 * on whichever host it lives, or from the open session. An allow of a high-risk request that was
 * not held is refused here, below every screen.
 */
export class PermissionsSlice {
  constructor(private readonly core: PermissionsCore) {}

  /** Answers a request from the "Precisa de você" queue, on whichever host it lives. */
  async respondTo(
    hostId: string,
    requestId: string,
    decision: "allow" | "deny",
    answer: Answer = {},
  ): Promise<void> {
    if (this.unheld(hostId, requestId, decision, answer)) return;
    if (decision === "allow") startMeasure("approve");
    // A request of the vault is answered in its own queue; any other goes to the host.
    const vaultAnswer = decision === "allow" ? ({ scope: "once", via: "app" } as const) : null;
    if (!this.core.settleVault(requestId, vaultAnswer)) {
      try {
        await this.core.sendOn(hostId, permissionResponse(requestId, decision, answer));
      } catch (error) {
        this.core.fail(error);
      }
    }
    if (decision === "allow") endMeasure("approve");
  }

  /** Answers a request of the session open in the window. */
  respond(requestId: string, decision: "allow" | "deny", answer: Answer = {}): Promise<void> {
    const hostId = this.core.selectedHostId();
    if (hostId && this.unheld(hostId, requestId, decision, answer)) return Promise.resolve();
    return this.core.sendSelected(permissionResponse(requestId, decision, answer));
  }

  /** The daemon's risk of a waiting request: its queue entry, else the session item it is. */
  private riskOf(hostId: string, requestId: string): RiskLevel | undefined {
    const queued = this.core
      .needsYou()
      .find((item) => item.hostId === hostId && item.requestId === requestId);
    if (queued?.risk) return queued.risk;
    for (const [key, session] of Object.entries(this.core.sessions())) {
      if (!key.startsWith(`${hostId}/`)) continue;
      const item = session.items.find((i) => i.kind === "permission" && i.requestId === requestId);
      if (item?.kind === "permission" && item.risk) return item.risk;
    }
    return undefined;
  }

  /**
   * An allow of a high-risk request that was not held is refused here, below every screen, and
   * the person is told why (#245). Deny never needs a hold.
   */
  private unheld(hostId: string, requestId: string, decision: "allow" | "deny", answer: Answer) {
    if (decision !== "allow" || answer.held || this.riskOf(hostId, requestId) !== "high") {
      return false;
    }
    const text = this.core.t()("approval.holdRequired");
    this.core.fail(new Error(text), text);
    return true;
  }
}
