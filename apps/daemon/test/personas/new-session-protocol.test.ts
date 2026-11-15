import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { startDaemon } from "../../src/main.ts";
import { ClaudeSdkRuntime, type QueryFn } from "../../src/runtime/claude-sdk-runtime.ts";
import { startServer } from "../../src/server.ts";
import { tempDir, workspace } from "../support/helpers.ts";
import { FrameClient } from "../support/history-helpers.ts";
import { cleanups, REVIEWER, setup, TOKEN, teardown } from "./new-session-setup.ts";

// Real processes (flightdeckd, the fake claude): more than the default 5 s.
setDefaultTimeout(40_000);
afterEach(teardown);
describe("personas-sessao-nova: o runtime do SDK", () => {
  function sdkOptions(persona?: { append: string; effort?: "high"; tools?: string[] | null }) {
    const seen: Options[] = [];
    const query: QueryFn = ({ options }) => {
      seen.push(options);
      return {
        async *[Symbol.asyncIterator]() {},
        interrupt: async () => {},
        close: () => {},
      };
    };
    const runtime = new ClaudeSdkRuntime({ query });
    runtime.start({
      cwd: "/work",
      permissionMode: "default",
      env: {},
      canUseTool: async () => ({ behavior: "deny", message: "x" }),
      ...(persona ? { persona } : {}),
    });
    return seen[0] as Options;
  }

  test("com persona: o preset do Claude Code com append, o esforço e as ferramentas como conjunto disponível, nunca allowedTools", () => {
    const options = sdkOptions({
      append: "Seja um revisor.",
      effort: "high",
      tools: ["Read", "Grep"],
    });
    expect(options.systemPrompt).toEqual({
      type: "preset",
      preset: "claude_code",
      append: "Seja um revisor.",
    });
    expect(options.effort).toBe("high");
    expect(options.tools).toEqual(["Read", "Grep"]);
    // allowedTools would pre-approve tools: a persona only ever restricts.
    expect("allowedTools" in options).toBe(false);
  });

  test("sem lista de ferramentas ou sem persona, nada muda no que já existia", () => {
    const noTools = sdkOptions({ append: "Texto.", tools: null });
    expect("tools" in noTools).toBe(false);
    expect("effort" in noTools).toBe(false);
    const plain = sdkOptions();
    expect(plain.systemPrompt).toEqual({ type: "preset", preset: "claude_code" });
    expect("tools" in plain).toBe(false);
    expect("effort" in plain).toBe(false);
  });
});

describe("personas-sessao-nova: pelo protocolo", () => {
  test("session.create com persona e personas.resolve", async () => {
    const { root, project, personas, start, manager } = await setup();
    const server = startServer({
      manager,
      personas: { store: personas },
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [root],
    });
    cleanups.push(() => server.stop());
    const client = new FrameClient(server.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    const created = await client.data<{ sessionId: string }>("session.create", {
      cwd: project,
      prompt: "oi",
      persona: { id: "revisor-host" },
    });
    expect(manager.get(created?.sessionId ?? "").persona).toMatchObject({ id: "revisor-host" });
    const code = async (type: string, payload: unknown) =>
      ((await client.request(type, payload)).error as { code?: string } | undefined)?.code ?? "ok";
    expect(await code("session.create", { cwd: project, prompt: "oi", persona: {} })).toBe(
      "bad_request",
    );
    expect(
      await code("session.create", {
        cwd: project,
        prompt: "oi",
        persona: { id: "a", definition: REVIEWER },
      }),
    ).toBe("bad_request");
    expect(
      await client.data("personas.resolve", { ref: { id: "revisor-host" }, projectPath: project }),
    ).toMatchObject({
      persona: { id: "revisor-host", effort: "high" },
      source: "host",
    });
    // A folder the daemon does not allow is not an error: only the host's and the pack's apply.
    expect(
      await client.data("personas.resolve", {
        ref: { id: "qa" },
        projectPath: join(root, "..", "fora"),
      }),
    ).toMatchObject({ source: "pack" });
    expect(await code("personas.resolve", { ref: { id: "nada" } })).toBe("not_found");
  });

  test("sem as personas configuradas, session.create com persona e personas.resolve dizem o erro", async () => {
    const { root, project, start, manager } = await setup({ personas: false });
    const server = startServer({
      manager,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [root],
    });
    cleanups.push(() => server.stop());
    const client = new FrameClient(server.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    const code = async (type: string, payload: unknown) =>
      ((await client.request(type, payload)).error as { code?: string } | undefined)?.code ?? "ok";
    expect(await code("personas.resolve", { ref: { id: "qa" } })).toBe("invalid_state");
    expect(
      await code("session.create", { cwd: project, prompt: "oi", persona: { id: "qa" } }),
    ).toBe("invalid_state");
  });
});

describe("personas-sessao-nova: o daemon inteiro", () => {
  test("o daemon liga as personas às sessões: abrir com uma persona do pacote dá o selo, e uma que não existe é recusada", async () => {
    const dir = tempDir();
    const { root, project } = workspace();
    const file = join(dir, "config.json");
    writeFileSync(
      file,
      JSON.stringify({
        port: 0,
        token: TOKEN,
        dataDir: join(dir, "data"),
        allowedRoots: [root],
        history: { roots: [join(dir, "nada")] },
      }),
    );
    const running = await startDaemon(
      { command: "start", config: file, runtime: "fake" },
      {},
      { log: () => {}, error: () => {} },
    );
    cleanups.push(() => running.stop());
    const client = new FrameClient(`ws://127.0.0.1:${new URL(running.url).port}/v1/ws`);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    const created = await client.data<{ sessionId: string }>("session.create", {
      cwd: project,
      prompt: "oi",
      persona: { id: "qa" },
    });
    const listed = await client.data<{ sessions: Array<{ id: string; persona?: { id: string } }> }>(
      "session.list",
      {},
    );
    expect(listed?.sessions.find((s) => s.id === created?.sessionId)?.persona?.id).toBe("qa");
    const missing = await client.request("session.create", {
      cwd: project,
      prompt: "oi",
      persona: { id: "nao-existe" },
    });
    expect((missing.error as { code?: string } | undefined)?.code).toBe("not_found");
  });
});
