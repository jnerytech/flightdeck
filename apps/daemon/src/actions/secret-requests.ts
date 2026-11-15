/**
 * Issue #1589 (moved out of actions.ts): how the daemon gets a secret for a use. The user's own run
 * finds it already delivered; anyone else's makes the daemon ask the app (`vault.request`), and the
 * app delivers it for that one request after the user's approval, or answers no. This is also where
 * the rules decide a use, the audit log records it and the approvals wait for their delivery.
 */
import type { Database } from "bun:sqlite";
import type {
  VaultAlertFrame,
  VaultDaemonRequester,
  VaultDecisionInfo,
  VaultReportRow,
  VaultRequester,
  VaultRequestFrame,
  VaultUsed,
  VaultVerdict,
} from "@flightdeck/protocol";
import { inSequence } from "@flightdeck/protocol";
import { FlightdeckError, ulid } from "../kernel/index.ts";
import {
  Decisions,
  decideRequest,
  evaluate,
  localTime,
  type RequestDecision,
  type Risk,
  type RulesEnv,
  requesterOf,
  toCsv,
  type UseContext,
  type Vault,
  type VaultRules,
} from "../vault/index.ts";
import { type Approval, approvalRefusal } from "./domain/approval-check.ts";
import {
  type Ask,
  approverOf,
  auditRowOf,
  requestFrameOf,
  type Waiting,
  waitRefusal,
  withSessionApproval,
} from "./domain/secret-use.ts";

export interface SecretRequestsOptions {
  db: Database;
  vault: Vault;
  /** How long a request waits for the app, and then is denied (10 minutes when absent). */
  requestTimeoutMs?: number;
  /** Phase 19: the rules of each secret; without them the requests of phase 17 apply. */
  rules?: VaultRules;
  /** This host's name, as the rules' `host` matches it. */
  hostName?: string;
  /** What the classifier of phase 13 says of a command. */
  risk?: (command: string, cwd: string) => Risk;
  clock?: () => number;
  /** The PC's time zone for the rules' windows (the system's when absent). */
  timeZone?: string;
}

export type ActionsFrame = VaultRequestFrame | VaultUsed | VaultAlertFrame;

/** A request nobody answers is denied after this long. */
export const REQUEST_TTL_MS = 10 * 60_000;

export const invalid = (
  message: string,
  reason?: string,
  params?: Record<string, string | number>,
) => new FlightdeckError("invalid_state", message, reason, params);

export class SecretRequests {
  private readonly listeners = new Set<(frame: ActionsFrame) => void>();
  private readonly pending = new Map<string, Waiting>();
  /** Secret, rule and session the user approved "for this session". */
  private readonly approvedSessions = new Set<string>();
  private readonly audit: Decisions;

  constructor(private readonly opts: SecretRequestsOptions) {
    this.audit = new Decisions(opts.db);
  }

  private ms(): number {
    return (this.opts.clock ?? Date.now)();
  }

  /** The clock, the PC's zone and the uses the rules' limits count. */
  private env(at?: number): RulesEnv {
    return {
      now: () => at ?? this.ms(),
      local: (ms) => localTime(ms, this.opts.timeZone),
      uses: (ruleId, sinceMs) => this.audit.uses(ruleId, sinceMs),
    };
  }

  /** The app's stream of `vault.request` and `vault.used` frames; answers how to stop it. */
  watch(listener: (frame: ActionsFrame) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The user refused a request: the run that waits for it fails at once. */
  deny(requestId: string): void {
    const waiting = this.pending.get(requestId);
    if (!waiting) return;
    waiting.denied = true;
    waiting.controller.abort();
  }

  /** The user approved a request that asked; the delivery of its secret is allowed after this. */
  approve(requestId: string, approval: Approval): void {
    const waiting = this.pending.get(requestId);
    if (!waiting) {
      throw new FlightdeckError(
        "not_found",
        `request ${requestId} does not exist: it expired, was refused or finished`,
        "action_request_gone",
      );
    }
    const refusal = approvalRefusal(waiting, approval);
    if (refusal) throw invalid(refusal.message, refusal.reason);
    waiting.approved = { by: approval.via, scope: approval.scope ?? "once" };
  }

  /** Throws unless a delivery for `purpose` may go through: a request that asks has to be approved. */
  gate(purpose: string): void {
    const waiting = this.pending.get(purpose.slice(purpose.lastIndexOf(":") + 1));
    if (waiting?.purpose === purpose && waiting.decision === "ask" && !waiting.approved) {
      throw invalid(
        "the request needs your approval before the secret is delivered",
        "action_needs_approval",
      );
    }
  }

  /** The verdict for a use, without recording anything. */
  preview(use: {
    secretId: string;
    requester: VaultRequester;
    purpose: "ssh" | "action" | "run_with_secret";
    action?: string;
    host?: string;
    tags?: string[];
    project?: string;
    session?: string;
    risk?: Risk;
    actionApproval?: "always" | "never" | "first-per-session";
    at?: number;
  }): VaultVerdict {
    const rules = this.opts.rules;
    const ctx: UseContext = {
      secretId: use.secretId,
      requester: use.requester,
      purpose: use.purpose,
      host: use.host ?? this.opts.hostName ?? "",
      tags: this.tagsOf(use.secretId, use.tags ?? []),
      ...(use.action !== undefined ? { action: use.action } : {}),
      ...(use.project !== undefined ? { project: use.project } : {}),
      ...(use.session !== undefined ? { session: use.session } : {}),
      ...(use.risk !== undefined ? { risk: use.risk } : {}),
      ...(use.actionApproval !== undefined ? { actionApproval: use.actionApproval } : {}),
    };
    return evaluate(rules?.rulesFor(use.secretId) ?? [], ctx, this.env(use.at));
  }

  decisions(input: { secretId?: string; days?: number; limit?: number }): VaultDecisionInfo[] {
    return this.audit.list(input, this.ms());
  }

  report(input: { days?: number; format?: "json" | "csv" }): {
    rows: VaultReportRow[];
    csv?: string;
  } {
    const rows = this.audit.report(input.days ?? 30, this.ms());
    return input.format === "csv" ? { rows, csv: toCsv(rows) } : { rows };
  }

  /** Nothing that waits outlives the daemon. */
  stop(): void {
    for (const waiting of this.pending.values()) waiting.controller.abort();
    this.listeners.clear();
  }

  /** The requester, if it is one that may ask the app for a secret. */
  permit(requester: VaultRequester): VaultDaemonRequester {
    const known = requesterOf(requester);
    if (known === "unknown") {
      throw invalid(
        "request refused: only Claude, an automation or a workflow ask the app for secrets this way",
        "action_requester_refused",
      );
    }
    return known;
  }

  /** The values, by id. The user's own run finds them delivered; anyone else's is asked of the app. */
  async collect(ids: string[], ask: Ask): Promise<Record<string, string>> {
    const secrets: Record<string, string> = {};
    await inSequence(ids, async (id) => {
      secrets[id] =
        ask.requester === "you"
          ? this.opts.vault.take(id, `${ask.purposeBase}:you`)
          : await this.request(id, { ...ask, requester: this.permit(ask.requester) });
    });
    return secrets;
  }

  /** The tags of the action and of the secret, without repeats. */
  private tagsOf(secretId: string, actionTags: readonly string[]): string[] {
    return [...new Set([...actionTags, ...(this.opts.rules?.tagsFor(secretId) ?? [])])];
  }

  /** The rules' verdict for one secret of this use, with the session approval applied. */
  private decide(
    secretId: string,
    ask: Ask & { requester: VaultDaemonRequester },
  ): {
    verdict: ReturnType<typeof decideRequest>;
    rememberedKey: string | null;
    remembered: boolean;
  } {
    const rules = this.opts.rules as VaultRules;
    const { use } = ask;
    const verdict = decideRequest(
      {
        requester: ask.requester,
        secretId,
        purpose: use.purpose,
        host: this.opts.hostName ?? "",
        tags: this.tagsOf(secretId, use.tags),
        ...(use.action ? { action: use.action } : {}),
        ...(use.project ? { project: use.project } : {}),
        ...(use.session ? { session: use.session } : {}),
        ...(use.actionApproval ? { actionApproval: use.actionApproval } : {}),
        ...(this.opts.risk ? { risk: this.opts.risk(use.command, use.cwd) } : {}),
      },
      rules.rulesFor(secretId),
      this.env(),
    );
    return withSessionApproval(verdict, secretId, use.session, this.approvedSessions);
  }

  /** Writes the request to the audit log and raises the alerts; throws when the rules deny the use. */
  private recordUse(
    requestId: string,
    secretId: string,
    ask: Ask & { requester: VaultDaemonRequester },
    verdict: RequestDecision,
  ): void {
    const isNew = this.audit.isNew(secretId, ask.requester);
    const rule = this.opts.rules?.rulesFor(secretId).find((r) => r.id === verdict.ruleId);
    this.audit.insert(
      auditRowOf({
        requestId,
        atMs: this.ms(),
        secretId,
        ask,
        host: this.opts.hostName ?? "",
        window: rule?.window,
        verdict,
      }),
    );
    if (isNew) {
      this.alert(
        "new-requester",
        secretId,
        ask.requester,
        `${ask.requester} used the secret ${secretId} for the first time`,
      );
    }
    if (verdict.granted) return;
    if (verdict.limited) this.alert("limit", secretId, ask.requester, `${verdict.reason}`);
    throw invalid(`use denied: ${verdict.reason}`, "action_use_denied", { detail: verdict.reason });
  }

  /** Closes the audit row of a granted request once the secret arrived, and remembers a session approval. */
  private recordDelivery(
    requestId: string,
    verdict: Extract<RequestDecision, { granted: true }>,
    waiting: Waiting,
    decided: { remembered: boolean; rememberedKey: string | null } | null,
  ): void {
    const approver = approverOf(
      verdict.decision,
      waiting.approved?.by,
      decided?.remembered ?? false,
    );
    this.audit.finish(requestId, verdict.decision === "allow" ? "allowed" : "approved", approver);
    if (waiting.approved?.scope === "session" && decided?.rememberedKey) {
      this.approvedSessions.add(decided.rememberedKey);
    }
  }

  /** The error a failed wait becomes: a refusal, an expiry, or the error itself. Closes the audit row. */
  private failure(error: unknown, requestId: string, secretId: string, waiting: Waiting): unknown {
    const refusal = waitRefusal(waiting, secretId);
    if (refusal) {
      this.audit.finish(requestId, refusal.outcome, null);
      return refusal.error;
    }
    this.audit.finish(requestId, "failed", null);
    return error;
  }

  /** Asks the app for one secret, for this request only, and waits for the delivery or the no. */
  private async request(
    secretId: string,
    ask: Ask & { requester: VaultDaemonRequester },
  ): Promise<string> {
    const rules = this.opts.rules;
    const requestId = ulid();
    const decided = rules ? this.decide(secretId, ask) : null;
    const verdict = decided?.verdict;
    if (rules && decided && verdict) this.recordUse(requestId, secretId, ask, verdict);
    if (this.listeners.size === 0) {
      this.audit.finish(requestId, "failed", null);
      throw invalid(
        "the app is not connected: it has to be open to release the secret",
        "action_app_offline",
      );
    }
    const purpose = `${ask.purposeBase}:${requestId}`;
    const timeoutMs = this.opts.requestTimeoutMs ?? REQUEST_TTL_MS;
    const waiting: Waiting = {
      controller: new AbortController(),
      denied: false,
      expired: false,
      needsHold: verdict?.granted ? verdict.needsHold : false,
      once: verdict?.granted ? verdict.once : false,
      purpose,
      ...(verdict?.granted ? { decision: verdict.decision } : {}),
    };
    this.pending.set(requestId, waiting);
    const timer = setTimeout(() => {
      waiting.expired = true;
      waiting.controller.abort();
    }, timeoutMs);
    // The wait is set up before the frame goes out, so a delivery cannot slip past it.
    const value = this.opts.vault.waitFor(
      secretId,
      purpose,
      timeoutMs + 1000,
      waiting.controller.signal,
    );
    this.emit(
      requestFrameOf({
        ask,
        requestId,
        secretId,
        purpose,
        verdict,
        tags: this.tagsOf(secretId, ask.use.tags),
        expiresAt: this.ms() + timeoutMs,
      }),
    );
    try {
      const secret = await value;
      if (rules && verdict?.granted) this.recordDelivery(requestId, verdict, waiting, decided);
      return secret;
    } catch (error) {
      throw this.failure(error, requestId, secretId, waiting);
    } finally {
      clearTimeout(timer);
      this.pending.delete(requestId);
    }
  }

  private alert(
    kind: "new-requester" | "limit",
    secretId: string,
    requester: VaultRequester,
    message: string,
  ): void {
    this.emit({
      type: "vault.alert",
      kind,
      secretId,
      requester,
      message,
      at: new Date(this.ms()).toISOString(),
    });
  }

  /** Tells every watcher of the app's stream. */
  emit(frame: ActionsFrame): void {
    for (const listener of this.listeners) listener(frame);
  }
}
