import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ExternalPermissions } from "../../src/central/external-permissions.ts";
import { runCli } from "../../src/main.ts";
import { AutoApprover, type AutoApproveSettings } from "../../src/permissions/auto-approve.ts";
import { RiskClassifier } from "../../src/permissions/domain/risk.ts";
import { localDay } from "../../src/quota/usage.ts";
import { FakeRuntime } from "../../src/runtime/fake-runtime.ts";
import { startServer } from "../../src/server.ts";
import { EventStore } from "../../src/store/event-store.ts";
import { gitRepo, newBoard } from "../support/board-helpers.ts";
import { newManager, poll, record, tempDir } from "../support/helpers.ts";
import { FrameClient } from "../support/history-helpers.ts";

import { cleanups, ON, setup, TOKEN, teardown } from "./auto-approve-setup.ts";

/** The hook's answer as JSON; null when it left the decision to the terminal (""). */
const answer = (body: string) => (body ? JSON.parse(body) : null);

afterEach(teardown);

describe("auto-approve: sessions, protocol and daemon start", () => {
  test("sessão gerenciada: medium aprovado pela IA resolve sozinho, com o motivo no evento", async () => {
    const runtime = new FakeRuntime({
      delayMs: 1,
      judge: () => ({ decision: "allow", reason: "teste dentro do pedido" }),
    });
    const store = new EventStore(":memory:");
    cleanups.push(() => store.close());
    const auto = new AutoApprover({
      db: store.db,
      runtime,
      dataDir: tempDir(),
      context: () => ({ projectId: "p1", settings: ON }),
    });
    const { manager, project } = newManager({ runtime, store, autoApprove: auto });
    const { sessionId } = await manager.create({ cwd: project, prompt: "[bash]" });
    const events = record(manager, sessionId);
    cleanups.push(() => events.unsubscribe());
    const resolved = await poll(() => events.find("permission.resolved")[0], 3000);
    expect(resolved).toMatchObject({
      decision: "allow",
      auto: { by: "ai", reason: "teste dentro do pedido", model: "claude-haiku-5-5" },
    });
    expect(await poll(() => events.find("tool.result")[0], 3000)).toBeDefined();
    // The turn ends before the store closes: a run still streaming would write to a closed one.
    expect(await poll(() => manager.get(sessionId).status === "idle", 3000)).toBe(true);
  });

  test("sessão do terminal: low aprovado mesmo sem app olhando; high fica com o terminal", async () => {
    const { auto, cwd } = setup();
    const permissions = new ExternalPermissions({
      risk: new RiskClassifier({ allowedRoots: [], home: tempDir() }),
      auto,
    });
    const hold = (toolName: string, input: Record<string, unknown>) =>
      permissions.hold(
        { session_id: "t1", cwd, tool_name: toolName, tool_input: input },
        new AbortController().signal,
      );
    expect(answer(await hold("Read", { file_path: "a.ts" }))).toEqual({
      hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } },
    });
    expect(await hold("Bash", { command: "rm -rf build" })).toBe("");
  });

  test("sessão do terminal com app olhando: o frame fecha como aprovado automaticamente", async () => {
    const { auto, cwd } = setup();
    const permissions = new ExternalPermissions({
      risk: new RiskClassifier({ allowedRoots: [], home: tempDir() }),
      auto,
    });
    const frames: Array<Record<string, unknown>> = [];
    cleanups.push(permissions.watch((frame) => frames.push(frame)));
    // Without the automatic answer the hook stays held: a second is plenty for the fake AI.
    const body = await Promise.race([
      permissions.hold(
        { session_id: "t1", cwd, tool_name: "Write", tool_input: { file_path: "a.ts" } },
        new AbortController().signal,
      ),
      Bun.sleep(1000).then(() => ""),
    ]);
    expect(answer(body)?.hookSpecificOutput.decision.behavior).toBe("allow");
    expect(frames.at(-1)).toMatchObject({
      state: "closed",
      resolution: "allow",
      auto: { by: "ai", reason: "claramente seguro" },
    });
  });

  test("protocolo: daemon sem a aprovação automática responde invalid_state", async () => {
    const { manager } = newManager();
    const server = startServer({
      manager,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [],
    });
    cleanups.push(() => server.stop());
    const client = new FrameClient(server.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    expect(await client.request("autoapprove.list", {})).toMatchObject({
      ok: false,
      error: { code: "invalid_state" },
    });
  });

  test("flightdeckd start: num projeto com a aprovação automática, o pedido medium passa pela IA falsa e a consulta entra nos custos", async () => {
    const { repo } = gitRepo();
    const dir = tempDir();
    const file = join(dir, "config.json");
    const token = "auto-start-token-0123456789ab";
    writeFileSync(
      file,
      JSON.stringify({
        port: 0,
        token,
        dataDir: join(dir, "data"),
        hooks: { port: 0 },
        allowedRoots: [dirname(repo)],
      }),
    );
    const daemon = await runCli(["--config", file, "--runtime", "fake"], {
      env: {},
      log: { log: () => {}, error: () => {} },
      exit: () => {},
      onSignal: () => {},
    });
    cleanups.push(() => daemon?.stop());
    const client = new FrameClient(daemon?.url ?? "");
    cleanups.push(() => client.close());
    await client.request("hello", { token, client: "t" });
    const project = await client.data<{ id: string }>("project.add", { path: repo });
    await client.data("project.update", {
      projectId: project?.id,
      autoApprove: { enabled: true },
    });
    await client.data("session.create", { cwd: repo, prompt: "[bash]" });
    let decisions: Array<{ decision: string; by: string }> = [];
    const deadline = Date.now() + 5000;
    while (decisions.length === 0 && Date.now() < deadline) {
      decisions =
        (await client.data<{ decisions: typeof decisions }>("autoapprove.list", {}))?.decisions ??
        [];
      if (decisions.length === 0) await Bun.sleep(50);
    }
    expect(decisions).toMatchObject([{ decision: "allow", by: "ai" }]);
    const today = localDay(Date.now());
    const summary = await client.data<{ byOrigin: Array<{ origin: string }> }>("costs.summary", {
      from: today,
      to: today,
    });
    expect(summary?.byOrigin.map((o) => o.origin)).toContain("auto-approve");
  }, 20_000);

  test("protocolo: a config do projeto, autoapprove.list e autoapprove.resume", async () => {
    const { board, manager, repo } = newBoard();
    const project = await board.addProject({ path: repo });
    expect(project.autoApprove).toEqual({
      enabled: false,
      model: "claude-haiku-5-5",
      lowWithoutAi: true,
    });
    const { auto } = setup();
    auto.suspend("s9", "conteúdo de terceiro");
    const server = startServer({
      manager,
      board,
      autoApprove: auto,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [],
    });
    cleanups.push(() => server.stop());
    const client = new FrameClient(server.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    const updated = await client.data<{ autoApprove: AutoApproveSettings }>("project.update", {
      projectId: project.id,
      autoApprove: { enabled: true },
    });
    expect(updated?.autoApprove).toEqual({ ...ON });
    expect(board.getProject(project.id).autoApprove.enabled).toBe(true);
    const listed = await client.data<{ suspended: Array<{ sessionKey: string }> }>(
      "autoapprove.list",
      {},
    );
    expect(listed?.suspended.map((s) => s.sessionKey)).toEqual(["s9"]);
    expect(await client.request("autoapprove.resume", { sessionKey: "s9" })).toMatchObject({
      ok: false,
      error: { code: "invalid_state" },
    });
    await client.data("autoapprove.resume", { sessionKey: "s9", confirm: true });
    expect(auto.suspended()).toEqual([]);
  });
});
