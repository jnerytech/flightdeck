import type { CommandPayload, CommandResults, VaultRequestFrame } from "@flightdeck/protocol";
import { HIGH_RISK_HOLD_MS } from "@/features/permissions/index.ts";
import type { Key, T } from "../../i18n/index.ts";
import type { PendingItem } from "../../lib/app-store.ts";
import type { SecretMeta, Vault } from "./vault.ts";
import { actionPolicy, type VaultAnswer } from "./vault-approval.ts";
import {
  answerVaultRequest,
  checkDelivery,
  type DeliveryRefusal,
  type VaultOutcome,
  type VaultPolicy,
  type VaultRequestContext,
} from "./vault-requests.ts";

/** The host a request came from, as far as the approvals go. */
export interface ApprovalHost {
  id: string;
  url: string;
}

/** The commands the approvals send to a host. */
type ApprovalCommand = "vault.approve" | "vault.deliver" | "vault.deny";

/** What the approvals read and ask through the app's store. */
export interface VaultApprovalsCore {
  vault: Vault;
  /** The requests waiting for the person, in order of arrival. */
  pending(): PendingItem[];
  setPending(items: PendingItem[]): void;
  /** The name of a host, for the queue's card; null when it is not known. */
  hostName(hostId: string): string | null;
  /** The address of a host, for the transport check; empty when it is not known. */
  hostUrl(hostId: string): string;
  /** A command to a host (`vault.approve`, `vault.deliver`, `vault.deny`). */
  dispatch<C extends ApprovalCommand>(
    hostId: string,
    type: C,
    payload: CommandPayload<C>,
  ): Promise<CommandResults[C]>;
  /** The policy the options chose; the one that puts requests to the person when absent. */
  optionsPolicy(): VaultPolicy | undefined;
  now(): number;
  /** Tells the person, in the bell and the OS, that a request waits. */
  notify(title: string, body: string): void;
  /** Writes down what a request ended in (the usage log) and tells the screens. */
  recorded(outcome: VaultOutcome): void;
  t(): T;
}

/**
 * The daemon's requests for a secret (phases 17 and 19; #1596: a slice of the store): the policy
 * decides each one, a request that must ask waits in the "Precisa de você" queue, and what it ended
 * in goes to the usage log and the listeners. A daemon's request never brings a value through
 * here: it goes from the vault to the daemon, in `answerVaultRequest`. Only `secretFor`, the app's
 * own use (ssh), hands a value back, to its caller.
 */
export class VaultApprovalsSlice {
  private readonly listeners = new Set<(outcome: VaultOutcome) => void>();
  /** The questions about the daemon's requests, answered from the queue, by request id. */
  private readonly questions = new Map<string, (answer: VaultAnswer | null) => void>();
  private defaultPolicy: VaultPolicy | null = null;

  constructor(private readonly core: VaultApprovalsCore) {}

  /** Calls `listener` with the result of each `vault.request` the daemon makes. */
  onOutcome(listener: (outcome: VaultOutcome) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Answers the question of a queued request; false when the request is not one of the vault's. */
  settle(requestId: string, answer: VaultAnswer | null): boolean {
    const question = this.questions.get(requestId);
    if (!question) return false;
    question(answer);
    return true;
  }

  /** A host's connection or entry is gone: its waiting requests are denied and leave the queue. */
  hostGone(_hostId: string): void {}

  /** Approves a request for a secret for the rest of the requester's session (phase 19). */
  approveForSession(hostId: string, requestId: string): void {
    // Only where the rule allows it and no hold is needed: the session approval has no button to
    // hold, so it can never stand in for one.
    const item = this.core.pending().find((i) => i.hostId === hostId && i.requestId === requestId);
    // A high-risk request (a free command, a rule that needs the hold) never gets it (#244).
    if (!item?.vaultOnce || item.risk === "high") return;
    this.questions.get(requestId)?.({ scope: "session", via: "app" });
  }

  /**
   * A secret of the vault for a use the app itself starts (ssh): the delivery rules are checked
   * for the host that will use it and the use is logged, as "you". The value is handed to the
   * caller and kept nowhere.
   */
  async secretFor(
    hostId: string,
    secretId: string,
    purpose: string,
  ): Promise<{ ok: true; value: string } | { ok: false; code: DeliveryRefusal }> {
    const check = await checkDelivery(secretId, {
      hostId,
      hostUrl: this.core.hostUrl(hostId),
      vault: this.core.vault,
    });
    this.core.recorded({
      hostId,
      secretId,
      purpose,
      requester: "you",
      delivered: check.ok,
      reason: check.ok ? "" : check.reason,
    });
    return check.ok ? { ok: true, value: check.value } : { ok: false, code: check.code };
  }

  /** A `vault.request` of the daemon: the policy decides, and nothing is delivered unless it says so. */
  async onRequest(host: ApprovalHost, request: VaultRequestFrame): Promise<void> {
    const outcome = await answerVaultRequest(request, {
      hostId: host.id,
      hostUrl: host.url,
      vault: this.core.vault,
      policy: this.policy(),
      deliver: (payload) => this.core.dispatch(host.id, "vault.deliver", payload),
      now: () => this.core.now(),
    });
    this.core.recorded(outcome);
    // A run that waits for the secret fails at once, instead of at the daemon's deadline.
    if (!outcome.delivered) {
      void this.core
        .dispatch(host.id, "vault.deny", { requestId: request.requestId })
        .catch(() => {});
    }
    for (const listener of this.listeners) listener(outcome);
  }

  /** The policy of the options, or the one that puts action requests to the person. */
  private policy(): VaultPolicy {
    this.defaultPolicy ??= actionPolicy({
      ask: (context) => this.ask(context),
      now: () => this.core.now(),
      // Phase 19: a request the rules made ask is approved on the daemon before the delivery.
      approve: async ({ request, hostId }, answer) => {
        await this.core.dispatch(hostId, "vault.approve", {
          requestId: request.requestId,
          via: answer.via,
          scope: answer.scope,
          ...(request.needsHold ? { heldMs: HIGH_RISK_HOLD_MS } : {}),
        });
      },
    });
    return this.core.optionsPolicy() ?? this.defaultPolicy;
  }

  /** Puts a request of the daemon for a secret in the queue and waits for the person's answer. */
  private ask({ request, hostId, secret }: VaultRequestContext): Promise<VaultAnswer | null> {
    const t = this.core.t();
    const free = request.command !== undefined;
    const requester = t(`actionsUi.requester.${request.requester}` as Key);
    const item = this.queued(hostId, request, secret, free, requester);
    this.core.notify(
      t("vaultApproval.notifyTitle"),
      t("vaultApproval.notifyBody", {
        requester,
        what: free ? "run_with_secret" : item.toolName,
        host: item.hostName,
      }),
    );
    return new Promise((resolve) => {
      // Phase 19: unanswered when the daemon gives up on it, it is denied and leaves the queue.
      const expiry =
        request.expiresAt === undefined
          ? undefined
          : setTimeout(
              () => this.questions.get(request.requestId)?.(null),
              Math.max(0, request.expiresAt - this.core.now()),
            );
      this.questions.set(request.requestId, (approved) => {
        clearTimeout(expiry);
        this.questions.delete(request.requestId);
        this.core.setPending(this.core.pending().filter((i) => i.requestId !== request.requestId));
        resolve(approved);
      });
      this.core.setPending([...this.core.pending(), item]);
    });
  }

  /** The card of the queue for a request: what it asks, who asks, and how it may be answered. */
  private queued(
    hostId: string,
    request: VaultRequestFrame,
    secret: SecretMeta | null,
    free: boolean,
    requester: string,
  ): PendingItem {
    const t = this.core.t();
    const input: Record<string, string> = {
      [t("vaultApproval.requester")]: requester,
      // Phase 19: the rule that made it ask, and the tags it saw.
      ...(request.reason ? { [t("vaultApproval.rule")]: request.reason } : {}),
      ...(request.tags?.length ? { [t("vaultApproval.tags")]: request.tags.join(", ") } : {}),
      ...(free
        ? {
            [t("vaultApproval.command")]: request.command ?? "",
            [t("vaultApproval.secrets")]: (
              request.secrets ?? [secret?.name ?? request.secretId]
            ).join(", "),
            ...(request.host ? { [t("vaultApproval.host")]: request.host } : {}),
          }
        : {
            [t("vaultApproval.action")]: request.action ?? "",
            [t("vaultApproval.secret")]: secret?.name ?? request.secretId,
            ...Object.fromEntries(
              Object.entries(request.params ?? {}).map(([k, v]) => [
                `${t("vaultApproval.param")} ${k}`,
                v,
              ]),
            ),
          }),
    };
    return {
      hostId,
      hostName: this.core.hostName(hostId) ?? hostId,
      sessionId: "",
      sessionName: t("vaultApproval.session", { requester }),
      requestId: request.requestId,
      toolName: free ? "run_with_secret" : (request.action ?? ""),
      createdAt: new Date(this.core.now()).toISOString(),
      input,
      ...(free || request.needsHold
        ? {
            risk: "high" as const,
            riskReason: free ? t("vaultApproval.freeReason") : (request.reason ?? ""),
          }
        : {}),
      vault: true,
      // A request that needs holding is approved only by the held button, one use at a time.
      // Not a free command either: it is high risk, and a session approval has no hold (#244).
      ...(request.once && !request.needsHold && !free ? { vaultOnce: true as const } : {}),
      vaultRule: {
        secretId: request.secretId,
        match: {
          requester: request.requester,
          // actionPolicy only asks for a request that names an action or a command.
          ...(free
            ? { purpose: "run_with_secret" }
            : { purpose: "action", action: request.action as string }),
        },
      },
    };
  }
}
