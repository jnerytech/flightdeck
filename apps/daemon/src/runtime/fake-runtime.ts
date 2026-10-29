import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AssistantBlock } from "@flightdeck/protocol";
import { AsyncQueue } from "../async-queue.ts";
import { ulid } from "../ulid.ts";
import { whichOnPath } from "../which.ts";
import type { AgentRun, AgentRuntime, RuntimeEvent, StartOptions } from "./types.ts";

export interface FakeRuntimeOptions {
  /** Delay between streamed chunks, in ms. */
  delayMs?: number;
}

class Interrupted extends Error {}

/**
 * Deterministic runtime with no network. Replies `Echo: <text>` in chunks, asks permission for
 * a `Write` tool when the message contains `[tool]`, writes and commits a file in its cwd on
 * `[commit]`, fails the run on `[fail]` and honors `interrupt`.
 */
export class FakeRuntime implements AgentRuntime {
  /** Every `start` call, so tests can inspect what the session manager handed over. */
  readonly starts: StartOptions[] = [];
  private readonly delayMs: number;

  constructor(options: FakeRuntimeOptions = {}) {
    this.delayMs = options.delayMs ?? 10;
  }

  start(opts: StartOptions): AgentRun {
    this.starts.push(opts);
    return new FakeRun(opts, this.delayMs);
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
  ) {
    this.claudeSessionId = opts.resume ?? `fake-${ulid().toLowerCase()}`;
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
    const started = Date.now();
    if (!this.initialized) {
      this.initialized = true;
      this.emit({
        type: "session.init",
        claudeSessionId: this.claudeSessionId,
        model: this.opts.model ?? "fake-model",
        tools: ["Read", "Write", "Bash"],
      });
    }
    try {
      await this.sleep(abort.signal);
      if (text.includes("[fail]")) throw new Error("falha simulada do runtime");
      if (text.includes("[tool]")) await this.toolCall(abort.signal);
      if (text.includes("[commit]")) this.commit(text);
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

  private async toolCall(signal: AbortSignal): Promise<void> {
    const preface = "Vou criar um arquivo.";
    await this.stream(preface, signal);
    const toolUseId = `toolu_${ulid().toLowerCase()}`;
    const input = { file_path: "fake.txt", content: "conteúdo de teste\n" };
    const blocks: AssistantBlock[] = [
      { type: "text", text: preface },
      { type: "tool_use", id: toolUseId, name: "Write", input },
    ];
    this.emit({ type: "message.assistant", blocks });

    const aborted = new Promise<never>((_, reject) => {
      signal.addEventListener("abort", () => reject(new Interrupted()), { once: true });
    });
    const decision = await Promise.race([
      this.opts.canUseTool("Write", input, { signal, toolUseId }),
      aborted,
    ]);
    if (decision.behavior === "allow") {
      const path = String(decision.updatedInput?.file_path ?? input.file_path);
      this.emit({
        type: "tool.result",
        toolUseId,
        content: `arquivo criado: ${path}`,
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
      durationMs: Date.now() - started,
      costUsd: 0,
      usage: { inputTokens: 10, outputTokens: 20 },
    });
  }
}
