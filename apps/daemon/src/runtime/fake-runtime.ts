import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AssistantBlock } from "@flightdeck/protocol";
import { AsyncQueue } from "../async-queue.ts";
import { ulid } from "../ulid.ts";
import { whichOnPath } from "../which.ts";
import type {
  AgentRun,
  AgentRuntime,
  ForkOptions,
  RewindFilesResult,
  RuntimeEvent,
  StartOptions,
} from "./types.ts";

export interface FakeRuntimeOptions {
  /** Delay between streamed chunks, in ms. */
  delayMs?: number;
  /** What `rewindFiles` answers (phase 12); without it, the fake has no checkpoint. */
  rewind?: (userMessageId: string, dryRun: boolean) => RewindFilesResult;
}

class Interrupted extends Error {}

/**
 * Deterministic runtime with no network. Replies `Echo: <text>` in chunks, asks permission for
 * a `Write` tool when the message contains `[tool]`, writes and commits a file in its cwd on
 * `[commit]`, fails the run on `[fail]` and honors `interrupt`. `[cost:x]` adds `x` to the
 * session's cumulative cost, which every `turn.result` reports (like `total_cost_usd`).
 * `[ratelimit:<window>=<fraction>@<epoch seconds>]` reports a plan quota reading, and
 * `[bash]` asks permission for a Bash command, with suggestions.
 */
export class FakeRuntime implements AgentRuntime {
  /** Every `start` call, so tests can inspect what the session manager handed over. */
  readonly starts: StartOptions[] = [];
  private readonly delayMs: number;
  /** Cumulative cost by Claude session id: a resumed session starts from its total. */
  private readonly costs = new Map<string, number>();

  constructor(options: FakeRuntimeOptions = {}) {
    this.delayMs = options.delayMs ?? 10;
    this.rewind = options.rewind;
  }

  private readonly rewind: FakeRuntimeOptions["rewind"];

  /** Forks asked so far (phase 12). */
  readonly forks: Array<{ claudeSessionId: string } & ForkOptions> = [];

  async forkSession(claudeSessionId: string, options: ForkOptions): Promise<{ sessionId: string }> {
    this.forks.push({ claudeSessionId, ...options });
    return { sessionId: `fake-fork-${ulid().toLowerCase()}` };
  }

  start(opts: StartOptions): AgentRun {
    this.starts.push(opts);
    return new FakeRun(opts, this.delayMs, this.costs, this.rewind);
  }
}

class FakeRun implements AgentRun {
  readonly events = new AsyncQueue<RuntimeEvent>();
  private readonly inbox: string[] = [];
  private processing = false;
  private initialized = false;
  private turnAbort: AbortController | null = null;
  private commits = 0;
  private readonly claudeSessionId: string;

  constructor(
    private readonly opts: StartOptions,
    private readonly delayMs: number,
    private readonly costs: Map<string, number>,
    private readonly rewind?: FakeRuntimeOptions["rewind"],
  ) {
    this.claudeSessionId = opts.resume ?? `fake-${ulid().toLowerCase()}`;
  }

  async rewindFiles(userMessageId: string, opts: { dryRun: boolean }): Promise<RewindFilesResult> {
    return (
      this.rewind?.(userMessageId, opts.dryRun) ?? { canRewind: false, error: "sem checkpoint" }
    );
  }

  send(text: string): void {
    if (this.events.isEnded) return;
    this.inbox.push(text);
    void this.pump();
  }

  async interrupt(): Promise<void> {
    this.turnAbort?.abort();
  }

  async close(): Promise<void> {
    this.turnAbort?.abort();
    this.inbox.length = 0;
    this.events.end();
  }

  private async pump(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      for (let text = this.inbox.shift(); text !== undefined; text = this.inbox.shift()) {
        await this.turn(text);
        if (this.events.isEnded) return;
      }
    } catch (error) {
      this.events.fail(error);
    } finally {
      this.processing = false;
    }
  }

  private emit(event: RuntimeEvent): void {
    this.events.push(event);
  }

  private async sleep(signal: AbortSignal): Promise<void> {
    if (this.delayMs > 0) await Bun.sleep(this.delayMs);
    else await Promise.resolve();
    if (signal.aborted) throw new Interrupted();
  }

  private async stream(text: string, signal: AbortSignal): Promise<void> {
    for (const chunk of text.match(/.{1,4}/gsu) ?? []) {
      this.emit({ type: "message.delta", text: chunk });
      await this.sleep(signal);
    }
  }

  private async turn(text: string): Promise<void> {
    const abort = new AbortController();
    this.turnAbort = abort;
    // Monotonic: a wall clock that syncs backwards (WSL, containers) would give a negative duration.
    const started = performance.now();
    if (!this.initialized) {
      this.initialized = true;
      this.emit({
        type: "session.init",
        claudeSessionId: this.claudeSessionId,
        model: this.opts.model ?? "fake-model",
        tools: ["Read", "Write", "Bash"],
      });
    }
    const windows = [...text.matchAll(/\[ratelimit:(\w+)=([\d.]+)@(\d+)\]/g)].map(
      ([, window = "", utilization, resetsAt]) => ({
        window,
        utilization: Number(utilization),
        status: Number(utilization) >= 1 ? ("rejected" as const) : ("allowed" as const),
        resetsAt: Number(resetsAt) * 1000,
      }),
    );
    if (windows.length > 0) this.emit({ type: "quota", windows });
    try {
      await this.sleep(abort.signal);
      if (text.includes("[fail]")) throw new Error("falha simulada do runtime");
      if (text.includes("[tool]")) await this.toolCall(abort.signal);
      if (text.includes("[bash]")) await this.bashCall(abort.signal);
      if (text.includes("[commit]")) this.commit(text);
      for (const [, cost] of text.matchAll(/\[cost:(\d+(?:\.\d+)?)\]/g)) {
        const total = this.costs.get(this.claudeSessionId) ?? 0;
        this.costs.set(this.claudeSessionId, total + Number(cost));
      }
      const reply = `Echo: ${text}`;
      await this.stream(reply, abort.signal);
      this.emit({ type: "message.assistant", blocks: [{ type: "text", text: reply }] });
      this.result("success", false, started);
    } catch (error) {
      if (!(error instanceof Interrupted)) throw error;
      if (!this.events.isEnded) this.result("error_during_execution", true, started);
    } finally {
      this.turnAbort = null;
    }
  }

  /** Writes `fake-<n>.txt` in the cwd and commits it, like an agent working on a card. */
  private commit(text: string): void {
    const file = `fake-${++this.commits}.txt`;
    writeFileSync(join(this.opts.cwd, file), `${text}\n`);
    for (const args of [
      ["add", file],
      ["commit", "-q", "-m", `fake: ${text}`],
    ]) {
      const git = Bun.spawnSync([whichOnPath("git") ?? "git", ...args], {
        cwd: this.opts.cwd,
        // The daemon's current environment, not the one it started with (see board/command.ts).
        env: process.env,
        stdout: "ignore",
        stderr: "pipe",
      });
      if (git.exitCode !== 0) throw new Error(`git ${args[0]}: ${git.stderr.toString().trim()}`);
    }
  }

  /** `[tool]`: a Write that asks permission, with the session suggestions the CLI would send. */
  private toolCall(signal: AbortSignal): Promise<void> {
    const input = { file_path: "fake.txt", content: "conteúdo de teste\n" };
    return this.permissionCall(signal, {
      preface: "Vou criar um arquivo.",
      toolName: "Write",
      input,
      suggestions: [
        { type: "addDirectories", directories: [this.opts.cwd], destination: "session" },
        { type: "setMode", mode: "acceptEdits", destination: "session" },
      ],
      done: (updated) => `arquivo criado: ${String(updated?.file_path ?? input.file_path)}`,
    });
  }

  /** `[bash]`: a Bash command that asks permission, suggesting a project rule and a session one. */
  private bashCall(signal: AbortSignal): Promise<void> {
    const command = "npm test --silent";
    return this.permissionCall(signal, {
      preface: "Vou rodar um comando.",
      toolName: "Bash",
      input: { command },
      suggestions: [
        {
          type: "addRules",
          rules: [{ toolName: "Bash", ruleContent: "npm test:*" }],
          behavior: "allow",
          destination: "localSettings",
        },
        {
          type: "addRules",
          rules: [{ toolName: "Bash", ruleContent: command }],
          behavior: "allow",
          destination: "session",
        },
      ],
      done: () => `comando executado: ${command}`,
    });
  }

  /**
   * Asks `canUseTool` like the CLI does. The tool result says what was allowed and, when the
   * answer carried `updatedPermissions`, repeats them: that is how a smoke sees them arrive.
   */
  private async permissionCall(
    signal: AbortSignal,
    call: {
      preface: string;
      toolName: string;
      input: Record<string, unknown>;
      suggestions: unknown[];
      done(updatedInput: Record<string, unknown> | undefined): string;
    },
  ): Promise<void> {
    await this.stream(call.preface, signal);
    const toolUseId = `toolu_${ulid().toLowerCase()}`;
    const blocks: AssistantBlock[] = [
      { type: "text", text: call.preface },
      { type: "tool_use", id: toolUseId, name: call.toolName, input: call.input },
    ];
    this.emit({ type: "message.assistant", blocks });

    const aborted = new Promise<never>((_, reject) => {
      signal.addEventListener("abort", () => reject(new Interrupted()), { once: true });
    });
    const decision = await Promise.race([
      this.opts.canUseTool(call.toolName, call.input, {
        signal,
        toolUseId,
        suggestions: call.suggestions,
      }),
      aborted,
    ]);
    if (decision.behavior === "allow") {
      const updates = decision.updatedPermissions;
      const granted = updates ? `; permissões: ${JSON.stringify(updates)}` : "";
      this.emit({
        type: "tool.result",
        toolUseId,
        content: `${call.done(decision.updatedInput)}${granted}`,
        isError: false,
      });
    } else {
      this.emit({ type: "tool.result", toolUseId, content: decision.message, isError: true });
    }
  }

  private result(subtype: string, isError: boolean, started: number): void {
    this.emit({
      type: "turn.result",
      subtype,
      isError,
      durationMs: Math.round(performance.now() - started),
      costUsd: this.costs.get(this.claudeSessionId) ?? 0,
      usage: { inputTokens: 10, outputTokens: 20 },
    });
  }
}
