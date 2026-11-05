/**
 * Phase 40: the assistant on the host: it checks a request, reads the repo when it writes a commit
 * or PR message, runs one call at a time on the host's `claude`, and records the usage. It logs the
 * kind, provider, model, time and tokens, never a text.
 */
import {
  ASSISTANT_MAX_INPUT,
  type AssistantContextBundle,
  type AssistantRecordPayload,
  AssistantRefusal,
  type AssistantResult,
  type AssistantRunPayload,
  buildRequest,
  type CommitSource,
  checkOutput,
  DEFAULT_MODELS,
  KIND_SPECS,
  type SecretScanner,
} from "@flightdeck/protocol";
import type { UsageIndexer } from "../costs/usage-indexer.ts";
import { FlightdeckError } from "../errors.ts";
import { type Quota, realTimers, type Timers } from "../quota/quota.ts";
import type { CompleteOptions, CompleteResult } from "../runtime/types.ts";
import { assistantDir } from "./paths.ts";

/** How long a second call waits for the one running on this host before it gives up. */
const WAIT_MS = 10_000;
/** The longest a call may take. */
const CEILING_MS = 90_000;

export interface AssistantServiceOptions {
  runtime: { complete(opts: CompleteOptions): Promise<CompleteResult> };
  usage: Pick<UsageIndexer, "record">;
  quota?: Pick<Quota, "blocked">;
  scanner: Pick<SecretScanner, "scan">;
  /** The repo bundle of a commit or PR message. */
  context(source: CommitSource): Promise<AssistantContextBundle>;
  dataDir: string;
  allowApiKey: boolean;
  timers?: Timers;
  now?: () => number;
  log?: (line: string) => void;
}

function refusal(reason: string, params?: Record<string, string | number>): FlightdeckError {
  return new FlightdeckError("invalid_state", reason, reason, params);
}

export class AssistantService {
  /** Settles when the last call taken (or waiting) has finished: one call at a time on a host. */
  private tail: Promise<void> = Promise.resolve();
  private readonly running = new Map<string, AbortController>();
  private readonly timers: Timers;
  private readonly now: () => number;

  constructor(readonly opts: AssistantServiceOptions) {
    this.timers = opts.timers ?? realTimers;
    this.now = opts.now ?? Date.now;
  }

  /** One field's suggestion: refused before any call when the text is empty, too long, holds a secret, or the plan is out. */
  async run(payload: AssistantRunPayload): Promise<AssistantResult> {
    try {
      return await this.checkedRun(payload);
    } catch (error) {
      throw error instanceof AssistantRefusal ? refusal(error.reason, error.params) : error;
    }
  }

  private async checkedRun(payload: AssistantRunPayload): Promise<AssistantResult> {
    if (payload.text.length > ASSISTANT_MAX_INPUT) {
      throw refusal("assistant_too_long", { max: ASSISTANT_MAX_INPUT });
    }
    if (payload.text.trim() === "" && !KIND_SPECS[payload.kind].generates) {
      throw refusal("assistant_empty_input");
    }
    const repo = payload.source ? await this.opts.context(payload.source) : undefined;
    const scanned = [payload.text, repo?.diff ?? "", repo?.rules ?? ""];
    const found = [...new Set(scanned.flatMap((text) => this.opts.scanner.scan(text)))];
    if (found.length > 0) throw refusal("assistant_secret_found", { labels: found.join(", ") });
    const blocked = this.opts.quota?.blocked();
    if (blocked) {
      const until = blocked.until === null ? "" : new Date(blocked.until).toISOString();
      throw refusal("assistant_quota_blocked", { until });
    }
    const model = payload.model ?? DEFAULT_MODELS.host[payload.profile];
    const request = buildRequest({
      requestId: payload.requestId,
      kind: payload.kind,
      text: payload.text,
      ...(payload.context ? { context: payload.context } : {}),
      language: payload.language,
      model,
      ...(repo ? { repo } : {}),
    });
    const release = await this.turn();
    try {
      return await this.call(payload, request.system, request.user, model, repo);
    } finally {
      release();
    }
  }

  /** Waits for the call before this one, up to `WAIT_MS`; answers what ends this one's turn. */
  private async turn(): Promise<() => void> {
    const previous = this.tail;
    const { promise: mine, resolve: release } = Promise.withResolvers<void>();
    this.tail = previous.then(() => mine);
    const late = Promise.withResolvers<"late">();
    const timer = this.timers.set(() => late.resolve("late"), WAIT_MS);
    const first = await Promise.race([previous.then(() => "ready" as const), late.promise]);
    this.timers.clear(timer);
    if (first === "late") {
      release();
      throw refusal("assistant_rate_limited");
    }
    return release;
  }

  private async call(
    payload: AssistantRunPayload,
    system: string,
    prompt: string,
    model: string,
    repo: AssistantContextBundle | undefined,
  ): Promise<AssistantResult> {
    const controller = new AbortController();
    this.running.set(payload.requestId, controller);
    let timedOut = false;
    const ceiling = this.timers.set(() => {
      timedOut = true;
      controller.abort();
    }, CEILING_MS);
    const started = this.now();
    let result: CompleteResult;
    try {
      result = await this.opts.runtime.complete({
        model,
        system,
        prompt,
        cwd: assistantDir(this.opts.dataDir),
        effort: "low",
        thinking: "off",
        allowApiKey: this.opts.allowApiKey,
        signal: controller.signal,
      });
    } catch (error) {
      throw timedOut ? refusal("assistant_timeout") : error;
    } finally {
      this.timers.clear(ceiling);
      this.running.delete(payload.requestId);
    }
    const { tokens } = result;
    this.opts.log?.(
      `assistant ${payload.kind} host ${model} ${this.now() - started} ms in ${tokens?.input ?? 0} out ${tokens?.output ?? 0}`,
    );
    if (tokens) {
      this.opts.usage.record({
        at: new Date(this.now()).toISOString(),
        model,
        tokens,
        projectPath: payload.cwd ?? assistantDir(this.opts.dataDir),
        messageId: `assistant-${payload.requestId}`,
        origin: "assistant",
        provider: "host",
      });
    }
    const commit = repo ? { conventional: repo.conventional, rules: repo.rules } : undefined;
    const checked = checkOutput(payload.kind, payload.text, result.text, commit);
    return {
      text: checked.text,
      model,
      provider: "host",
      usage: {
        inputTokens: tokens?.input ?? 0,
        outputTokens: tokens?.output ?? 0,
        cacheReadTokens: tokens?.cacheRead ?? 0,
        cacheWriteTokens: (tokens?.cacheWrite5m ?? 0) + (tokens?.cacheWrite1h ?? 0),
      },
      stopReason: result.subtype,
      notices: [
        ...checked.notices,
        ...(repo?.truncated ? ["diff_truncated"] : []),
        ...(repo && repo.redactedLines > 0 ? ["lines_redacted"] : []),
      ],
    };
  }

  /** Stops a running call; an id with no call is nothing. */
  cancel(requestId: string): void {
    this.running.get(requestId)?.abort();
  }

  /** The redacted repo bundle, for a provider the app calls itself. */
  context(payload: {
    kind: "commit" | "pr";
    source: CommitSource;
  }): Promise<AssistantContextBundle> {
    return this.opts.context(payload.source);
  }

  /** The usage of a call the app made itself; idempotent by its id. */
  record(payload: AssistantRecordPayload): void {
    const { tokens } = payload;
    this.opts.usage.record({
      at: payload.at,
      model: payload.model,
      tokens: {
        model: payload.model,
        speed: "standard",
        input: tokens.input,
        output: tokens.output,
        cacheRead: tokens.cacheRead,
        cacheWrite5m: tokens.cacheWrite,
        cacheWrite1h: 0,
      },
      projectPath: payload.cwd ?? assistantDir(this.opts.dataDir),
      messageId: `assistant-${payload.id}`,
      origin: "assistant",
      provider: payload.provider,
      ...(payload.costUsd !== undefined ? { costUsd: payload.costUsd } : {}),
    });
  }
}
