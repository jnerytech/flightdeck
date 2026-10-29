import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SessionEvent } from "@flightdeck/protocol";
import { FakeRuntime } from "../src/runtime/fake-runtime.ts";
import type { CanUseToolFn, StartOptions } from "../src/runtime/types.ts";
import { git, gitRepo } from "./board-helpers.ts";
import { tempDir } from "./helpers.ts";

function opts(canUseTool: CanUseToolFn, extra: Partial<StartOptions> = {}): StartOptions {
  return { cwd: "/x", permissionMode: "default", env: {}, canUseTool, ...extra };
}

const allowAll: CanUseToolFn = async () => ({ behavior: "allow" });

/** Collects events until (and including) the first one matching `stop`. */
async function collectUntil(
  events: AsyncIterator<SessionEvent>,
  stop: (e: SessionEvent) => boolean,
): Promise<SessionEvent[]> {
  const out: SessionEvent[] = [];
  for (;;) {
    const { value, done } = await events.next();
    if (done) return out;
    out.push(value);
    if (stop(value)) return out;
  }
}

const isResult = (e: SessionEvent) => e.type === "turn.result";

describe("FakeRuntime", () => {
  test("turno simples: init, deltas, message.assistant e turn.result", async () => {
    const run = new FakeRuntime({ delayMs: 0 }).start(opts(allowAll));
    const it = run.events[Symbol.asyncIterator]();
    run.send("olá");
    const events = await collectUntil(it, isResult);
    const types = events.map((e) => e.type);
    expect(types[0]).toBe("session.init");
    expect(types.filter((t) => t === "message.delta").length).toBeGreaterThan(1);
    expect(types.slice(-2)).toEqual(["message.assistant", "turn.result"]);
    const deltas = events.flatMap((e) => (e.type === "message.delta" ? [e.text] : []));
    const assistant = events.find((e) => e.type === "message.assistant");
    expect(assistant?.type === "message.assistant" && assistant.blocks).toEqual([
      { type: "text", text: deltas.join("") },
    ]);
    const result = events.at(-1);
    expect(result?.type === "turn.result" && result.subtype).toBe("success");
    await run.close();
  });

  test("[tool] pede permissão; allow gera tool.result de sucesso", async () => {
    const asked: string[] = [];
    const run = new FakeRuntime({ delayMs: 0 }).start(
      opts(async (toolName) => {
        asked.push(toolName);
        return { behavior: "allow" };
      }),
    );
    const it = run.events[Symbol.asyncIterator]();
    run.send("faça [tool]");
    const events = await collectUntil(it, isResult);
    expect(asked).toEqual(["Write"]);
    const toolResult = events.find((e) => e.type === "tool.result");
    expect(toolResult?.type === "tool.result" && toolResult.isError).toBe(false);
    await run.close();
  });

  test("[tool] com deny encerra a chamada com a mensagem", async () => {
    const run = new FakeRuntime({ delayMs: 0 }).start(
      opts(async () => ({ behavior: "deny", message: "não pode" })),
    );
    const it = run.events[Symbol.asyncIterator]();
    run.send("[tool]");
    const events = await collectUntil(it, isResult);
    const toolResult = events.find((e) => e.type === "tool.result");
    expect(toolResult).toMatchObject({ type: "tool.result", isError: true, content: "não pode" });
    await run.close();
  });

  test("interrupt aborta o pedido de permissão e encerra o turno", async () => {
    let signal: AbortSignal | undefined;
    const run = new FakeRuntime({ delayMs: 0 }).start(
      opts((_name, _input, ctx) => {
        signal = ctx.signal;
        return new Promise(() => {});
      }),
    );
    const it = run.events[Symbol.asyncIterator]();
    run.send("[tool]");
    await collectUntil(it, (e) => e.type === "message.assistant");
    await Bun.sleep(5);
    await run.interrupt();
    const events = await collectUntil(it, isResult);
    expect(signal?.aborted).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: "turn.result", isError: true });
    await run.close();
  });

  test("resume mantém o claudeSessionId e registra o env recebido", async () => {
    const runtime = new FakeRuntime({ delayMs: 0 });
    const run = runtime.start(opts(allowAll, { resume: "claude-123", env: { FOO: "bar" } }));
    const it = run.events[Symbol.asyncIterator]();
    run.send("oi");
    const [init] = await collectUntil(it, isResult);
    expect(init).toMatchObject({ type: "session.init", claudeSessionId: "claude-123" });
    expect(runtime.starts[0]?.env).toEqual({ FOO: "bar" });
    await run.close();
  });

  test("close encerra o stream de eventos", async () => {
    const run = new FakeRuntime({ delayMs: 0 }).start(opts(allowAll));
    const it = run.events[Symbol.asyncIterator]();
    await run.close();
    expect((await it.next()).done).toBe(true);
  });
});

describe("FakeRuntime: [commit]", () => {
  test("cria um arquivo no cwd e commita, como um agente faria", async () => {
    const { repo } = gitRepo();
    const run = new FakeRuntime({ delayMs: 0 }).start(opts(allowAll, { cwd: repo }));
    const it = run.events[Symbol.asyncIterator]();
    run.send("crie o arquivo [commit]");
    const first = await collectUntil(it, isResult);
    expect(first.at(-1)).toMatchObject({ type: "turn.result", isError: false });
    expect(git(repo, "status", "--porcelain")).toBe("");
    expect(git(repo, "log", "-1", "--format=%s")).toBe("fake: crie o arquivo [commit]");
    expect(git(repo, "show", "--name-only", "--format=", "HEAD")).toBe("fake-1.txt");
    const file = join(repo, "fake-1.txt");
    expect(existsSync(file) ? readFileSync(file, "utf8") : "").toBe("crie o arquivo [commit]\n");
    run.send("outro [commit]");
    await collectUntil(it, isResult);
    expect(git(repo, "show", "--name-only", "--format=", "HEAD")).toBe("fake-2.txt");
    await run.close();
  });

  test("fora de um repositório git, o commit falha e o runtime acusa o erro", async () => {
    const run = new FakeRuntime({ delayMs: 0 }).start(opts(allowAll, { cwd: tempDir() }));
    const it = run.events[Symbol.asyncIterator]();
    run.send("[commit]");
    const result = await collectUntil(it, isResult).then(
      () => "turno terminou",
      (error: Error) => error.message,
    );
    expect(result.startsWith("git ")).toBe(true);
  });
});
