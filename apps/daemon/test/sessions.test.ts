import { describe, expect, test } from "bun:test";
import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { buildChildEnv } from "../src/env.ts";
import { FlightdeckError } from "../src/errors.ts";
import { resolveAllowedCwd } from "../src/paths.ts";
import { PermissionBroker } from "../src/permissions/permission-broker.ts";
import { FakeRuntime } from "../src/runtime/fake-runtime.ts";
import { SessionManager } from "../src/sessions/session-manager.ts";
import { EventStore } from "../src/store/event-store.ts";
import { newManager, record, tempDir, waitFor } from "./helpers.ts";

const errorCode = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return error instanceof FlightdeckError ? error.code : String(error);
  }
  return "no error";
};

describe("ciclo de vida", () => {
  test("create → running → deltas → message.assistant → turn.result → idle", async () => {
    const { manager, project, store } = newManager();
    const { sessionId } = manager.create({ cwd: project, prompt: "olá" });
    const rec = record(manager, sessionId);
    await waitFor(() => manager.get(sessionId).status === "idle", { label: "idle" });

    const types = rec.events().map((e) => e.type);
    expect(types[0]).toBe("session.created");
    expect(rec.statuses()).toEqual(["starting", "running", "idle"]);
    expect(types.indexOf("message.user")).toBeLessThan(types.indexOf("message.assistant"));
    expect(types.indexOf("message.assistant")).toBeLessThan(types.indexOf("turn.result"));
    expect(rec.count("session.init")).toBe(1);
    // message.delta is live-only: it reached the subscriber but is not in the log.
    expect(rec.count("message.delta")).toBeGreaterThan(0);
    expect(store.eventsSince(sessionId).some((e) => e.event.type === "message.delta")).toBe(false);
    expect(manager.get(sessionId).claudeSessionId).toStartWith("fake-");
  });

  test("subscriber ao vivo recebe deltas antes do message.assistant", async () => {
    const { manager, project } = newManager();
    const { sessionId } = manager.create({ cwd: project, prompt: "olá mundo" });
    const live: string[] = [];
    manager.subscribe(sessionId, 0, (e) => live.push(e.event.type));
    await waitFor(() => manager.get(sessionId).status === "idle");
    expect(live.indexOf("message.delta")).toBeGreaterThanOrEqual(0);
    expect(live.indexOf("message.delta")).toBeLessThan(live.lastIndexOf("message.assistant"));
  });

  test("send em idle inicia novo turno", async () => {
    const { manager, project } = newManager();
    const { sessionId } = manager.create({ cwd: project, prompt: "primeiro" });
    const rec = record(manager, sessionId);
    await waitFor(() => manager.get(sessionId).status === "idle");
    expect(manager.send(sessionId, "segundo")).toEqual({ queued: false });
    await waitFor(() => rec.count("turn.result") === 2 && manager.get(sessionId).status === "idle");
    expect(rec.statuses()).toEqual(["starting", "running", "idle", "running", "idle"]);
    expect(rec.find("message.user").map((e) => e.text)).toEqual(["primeiro", "segundo"]);
  });

  test("close encerra; send depois de ended é recusado", async () => {
    const { manager, project } = newManager();
    const { sessionId } = manager.create({ cwd: project, prompt: "oi" });
    await waitFor(() => manager.get(sessionId).status === "idle");
    await manager.close(sessionId);
    expect(manager.get(sessionId).status).toBe("ended");
    expect(errorCode(() => manager.send(sessionId, "x"))).toBe("invalid_state");
  });

  test("falha do runtime leva a error com session.error", async () => {
    const { manager, project } = newManager();
    const { sessionId } = manager.create({ cwd: project, prompt: "[fail]" });
    const rec = record(manager, sessionId);
    await waitFor(() => manager.get(sessionId).status === "error");
    expect(rec.find("session.error")[0]?.message).toContain("falha simulada");
  });

  test("sessão inexistente é not_found", () => {
    const { manager } = newManager();
    expect(errorCode(() => manager.send("nope", "x"))).toBe("not_found");
  });
});

describe("fila", () => {
  test("mensagens enviadas durante running são entregues nos turnos seguintes, em ordem", async () => {
    const { manager, project } = newManager();
    const { sessionId } = manager.create({ cwd: project, prompt: "um" });
    const rec = record(manager, sessionId);
    expect(manager.send(sessionId, "dois")).toEqual({ queued: true });
    expect(manager.send(sessionId, "três")).toEqual({ queued: true });
    await waitFor(
      () => rec.count("turn.result") === 3 && manager.get(sessionId).status === "idle",
      {
        label: "três turnos",
      },
    );

    const sequence = rec
      .events()
      .filter((e) => e.type === "message.user" || e.type === "turn.result")
      .map((e) => (e.type === "message.user" ? e.text : "|"));
    expect(sequence).toEqual(["um", "|", "dois", "|", "três", "|"]);
  });
});

describe("permissão", () => {
  test("[tool] gera permission.requested e allow segue o turno", async () => {
    const { manager, project, store } = newManager();
    const { sessionId } = manager.create({ cwd: project, prompt: "crie [tool]" });
    const rec = record(manager, sessionId);
    const [req] = await waitFor(
      () => rec.find("permission.requested").length > 0 && rec.find("permission.requested"),
    );
    expect(req?.toolName).toBe("Write");
    expect(manager.get(sessionId).status).toBe("awaiting_permission");

    manager.respondPermission({ requestId: req?.requestId ?? "", decision: "allow" });
    await waitFor(() => manager.get(sessionId).status === "idle");
    expect(rec.find("permission.resolved")[0]).toMatchObject({ decision: "allow" });
    expect(rec.find("tool.result")[0]?.isError).toBe(false);
    expect(rec.statuses()).toEqual([
      "starting",
      "running",
      "awaiting_permission",
      "running",
      "idle",
    ]);
    expect(store.getPermission(req?.requestId ?? "")?.status).toBe("allowed");
  });

  test("allow com updatedInput repassa o input alterado", async () => {
    const { manager, project } = newManager();
    const { sessionId } = manager.create({ cwd: project, prompt: "[tool]" });
    const rec = record(manager, sessionId);
    const [req] = await waitFor(
      () => rec.find("permission.requested").length > 0 && rec.find("permission.requested"),
    );
    manager.respondPermission({
      requestId: req?.requestId ?? "",
      decision: "allow",
      updatedInput: { file_path: "outro.txt", content: "x" },
    });
    await waitFor(() => manager.get(sessionId).status === "idle");
    expect(rec.find("tool.result")[0]?.content).toContain("outro.txt");
  });

  test("deny encerra a chamada com a mensagem", async () => {
    const { manager, project, store } = newManager();
    const { sessionId } = manager.create({ cwd: project, prompt: "[tool]" });
    const rec = record(manager, sessionId);
    const [req] = await waitFor(
      () => rec.find("permission.requested").length > 0 && rec.find("permission.requested"),
    );
    manager.respondPermission({
      requestId: req?.requestId ?? "",
      decision: "deny",
      message: "aqui não",
    });
    await waitFor(() => manager.get(sessionId).status === "idle");
    expect(rec.find("permission.resolved")[0]).toMatchObject({
      decision: "deny",
      message: "aqui não",
    });
    expect(rec.find("tool.result")[0]).toMatchObject({ isError: true, content: "aqui não" });
    expect(store.getPermission(req?.requestId ?? "")?.status).toBe("denied");
  });

  test("interrupt marca o pedido como cancelled", async () => {
    const { manager, project, store } = newManager();
    const { sessionId } = manager.create({ cwd: project, prompt: "[tool]" });
    const rec = record(manager, sessionId);
    const [req] = await waitFor(
      () => rec.find("permission.requested").length > 0 && rec.find("permission.requested"),
    );
    await manager.interrupt(sessionId);
    await waitFor(() => manager.get(sessionId).status === "idle", { label: "idle após interrupt" });
    expect(rec.find("permission.resolved")[0]).toMatchObject({ decision: "cancelled" });
    expect(store.getPermission(req?.requestId ?? "")?.status).toBe("cancelled");
    expect(
      errorCode(() =>
        manager.respondPermission({ requestId: req?.requestId ?? "", decision: "allow" }),
      ),
    ).toBe("not_found");
  });

  test("responder pedido inexistente é not_found", () => {
    const { manager } = newManager();
    expect(errorCode(() => manager.respondPermission({ requestId: "x", decision: "allow" }))).toBe(
      "not_found",
    );
  });
});

describe("reinício", () => {
  function crashedState() {
    const dir = tempDir();
    const dbPath = join(dir, "flightdeck.db");
    const { root, project } = (() => {
      const r = tempDir("fd-root-");
      const p = join(r, "p");
      mkdirSync(p);
      return { root: r, project: p };
    })();
    // State left behind by a daemon that died mid-turn.
    const store = new EventStore(dbPath);
    for (const [id, status] of [
      ["running-1", "running"],
      ["waiting-1", "awaiting_permission"],
      ["idle-1", "idle"],
    ] as const) {
      store.createSession({
        id,
        name: null,
        cwd: project,
        status,
        permissionMode: "default",
        model: null,
      });
      store.updateSession(id, { claudeSessionId: `claude-${id}` });
    }
    store.createPermission({ id: "perm-1", sessionId: "waiting-1", toolName: "Write", input: {} });
    store.close();
    return { dbPath, root };
  }

  test("sessão running vira error, pending vira expired, resume reabre", async () => {
    const { dbPath, root } = crashedState();
    const store = new EventStore(dbPath);
    const runtime = new FakeRuntime({ delayMs: 1 });
    const manager = new SessionManager({
      store,
      runtime,
      allowedRoots: [root],
      defaultPermissionMode: "default",
      allowApiKey: false,
      baseEnv: {},
    });

    expect(manager.get("running-1").status).toBe("error");
    expect(manager.get("waiting-1").status).toBe("error");
    expect(manager.get("idle-1").status).toBe("idle");
    const rec = record(manager, "running-1");
    expect(rec.find("session.status").at(-1)).toMatchObject({
      status: "error",
      reason: "daemon reiniciado",
    });
    expect(store.getPermission("perm-1")?.status).toBe("expired");
    expect(record(manager, "waiting-1").find("permission.resolved")[0]).toMatchObject({
      requestId: "perm-1",
      decision: "expired",
    });

    await manager.resume("running-1");
    expect(runtime.starts.at(-1)?.resume).toBe("claude-running-1");
    expect(manager.get("running-1").status).toBe("idle");
    manager.send("running-1", "continua");
    await waitFor(
      () => rec.count("turn.result") === 1 && manager.get("running-1").status === "idle",
    );
  });

  test("resume só é aceito em ended ou error", () => {
    const { dbPath, root } = crashedState();
    const manager = new SessionManager({
      store: new EventStore(dbPath),
      runtime: new FakeRuntime({ delayMs: 1 }),
      allowedRoots: [root],
      defaultPermissionMode: "default",
      allowApiKey: false,
      baseEnv: {},
    });
    expect(errorCode(() => manager.resume("idle-1"))).toBe("invalid_state");
  });

  test("sessão encerrada pelo usuário pode ser retomada", async () => {
    const { manager, project, runtime } = newManager();
    const { sessionId } = manager.create({ cwd: project, prompt: "oi" });
    await waitFor(() => manager.get(sessionId).status === "idle");
    const claudeId = manager.get(sessionId).claudeSessionId;
    await manager.close(sessionId);
    await manager.resume(sessionId);
    expect((runtime as FakeRuntime).starts.at(-1)?.resume).toBe(claudeId ?? "");
    expect(manager.get(sessionId).status).toBe("idle");
  });
});

describe("pastas", () => {
  const setup = () => {
    const root = tempDir("fd-root-");
    const outside = tempDir("fd-out-");
    mkdirSync(join(root, "proj"));
    return { root, outside };
  };

  test("subpasta de allowedRoots é aceita e resolvida", () => {
    const { root } = setup();
    expect(resolveAllowedCwd(join(root, "proj"), [root])).toBe(join(root, "proj"));
    expect(resolveAllowedCwd(root, [root])).toBe(root);
  });

  test("pasta fora de allowedRoots é recusada", () => {
    const { root, outside } = setup();
    expect(errorCode(() => resolveAllowedCwd(outside, [root]))).toBe("forbidden_cwd");
  });

  test("escape via .. é recusado", () => {
    const { root, outside } = setup();
    const sneaky = join(root, "proj", "..", "..", outside.split(/[\\/]/).at(-1) ?? "");
    expect(errorCode(() => resolveAllowedCwd(sneaky, [root]))).toBe("forbidden_cwd");
  });

  test("escape via symlink é recusado", () => {
    const { root, outside } = setup();
    const link = join(root, "link");
    symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
    expect(errorCode(() => resolveAllowedCwd(link, [root]))).toBe("forbidden_cwd");
  });

  test("prefixo parecido não conta como dentro", () => {
    const { root } = setup();
    const sibling = `${root}-irmao`;
    mkdirSync(sibling);
    expect(errorCode(() => resolveAllowedCwd(sibling, [root]))).toBe("forbidden_cwd");
  });

  test("pasta inexistente e allowedRoots vazio são recusados", () => {
    const { root } = setup();
    expect(errorCode(() => resolveAllowedCwd(join(root, "nao-existe"), [root]))).toBe(
      "forbidden_cwd",
    );
    expect(errorCode(() => resolveAllowedCwd(root, []))).toBe("forbidden_cwd");
  });

  test("session.create com cwd proibido não cria sessão", () => {
    const { manager } = newManager();
    const outside = tempDir("fd-out-");
    expect(errorCode(() => manager.create({ cwd: outside, prompt: "oi" }))).toBe("forbidden_cwd");
    expect(manager.list()).toHaveLength(0);
  });
});

describe("ambiente", () => {
  const base = {
    PATH: "/usr/bin",
    ANTHROPIC_API_KEY: "sk-test",
    ANTHROPIC_AUTH_TOKEN: "tok",
    CLAUDE_CODE_OAUTH_TOKEN: "oauth",
  };

  test("env entregue ao runtime não contém ANTHROPIC_API_KEY com allowApiKey false", async () => {
    const { manager, project, runtime } = newManager({ baseEnv: base });
    manager.create({ cwd: project, prompt: "oi" });
    const env = (runtime as FakeRuntime).starts[0]?.env ?? {};
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe("oauth");
    expect(env.PATH).toBe("/usr/bin");
  });

  test("allowApiKey true repassa a chave", () => {
    const { manager, project, runtime } = newManager({ baseEnv: base, allowApiKey: true });
    manager.create({ cwd: project, prompt: "oi" });
    expect((runtime as FakeRuntime).starts[0]?.env.ANTHROPIC_API_KEY).toBe("sk-test");
  });

  test("buildChildEnv ignora caixa e valores indefinidos", () => {
    const env = buildChildEnv({ anthropic_api_key: "x", EMPTY: undefined, KEEP: "1" }, false);
    expect(env).toEqual({ KEEP: "1" });
  });
});

describe("ciclo de vida — bordas", () => {
  test("sessão idle de um daemon anterior é reanexada no próximo send", async () => {
    const dir = tempDir();
    const dbPath = join(dir, "fd.db");
    const first = newManager({ store: new EventStore(dbPath) });
    const { sessionId } = first.manager.create({ cwd: first.project, prompt: "oi" });
    await waitFor(() => first.manager.get(sessionId).status === "idle");
    const claudeId = first.manager.get(sessionId).claudeSessionId;
    await first.manager.shutdown();

    const runtime = new FakeRuntime({ delayMs: 1 });
    const second = new SessionManager({
      store: new EventStore(dbPath),
      runtime,
      allowedRoots: [first.root],
      defaultPermissionMode: "default",
      allowApiKey: false,
      baseEnv: {},
    });
    expect(second.get(sessionId).status).toBe("idle");
    expect(second.send(sessionId, "voltei")).toEqual({ queued: false });
    expect(runtime.starts[0]?.resume).toBe(claudeId ?? "");
    await waitFor(() => second.get(sessionId).status === "idle");
  });

  test("runtime que termina sozinho leva a error", async () => {
    const { manager, project } = newManager({
      runtime: {
        start: () => ({
          events: (async function* () {})(),
          send: () => {},
          interrupt: async () => {},
          close: async () => {},
        }),
      },
    });
    const { sessionId } = manager.create({ cwd: project, prompt: "oi" });
    await waitFor(() => manager.get(sessionId).status === "error");
    expect(record(manager, sessionId).find("session.error")[0]?.code).toBe("runtime_exit");
  });

  test("listener com erro não quebra a sessão; interrupt sem runtime e close repetido são inofensivos", async () => {
    const { manager, project } = newManager();
    const { sessionId } = manager.create({ cwd: project, prompt: "oi" });
    manager.subscribe(sessionId, 0, () => {
      throw new Error("listener ruim");
    });
    await waitFor(() => manager.get(sessionId).status === "idle");
    await manager.close(sessionId);
    await manager.close(sessionId);
    await manager.interrupt(sessionId);
    expect(manager.get(sessionId).status).toBe("ended");
  });

  test("sessão em error pode ser encerrada", async () => {
    const { manager, project } = newManager();
    const { sessionId } = manager.create({ cwd: project, prompt: "[fail]" });
    await waitFor(() => manager.get(sessionId).status === "error");
    await manager.close(sessionId);
    expect(manager.get(sessionId).status).toBe("ended");
  });

  test("create usa nome, modelo e modo informados", () => {
    const { manager, project, runtime } = newManager();
    const { sessionId } = manager.create({
      cwd: project,
      prompt: "oi",
      name: "nome",
      model: "opus",
      permissionMode: "plan",
    });
    expect(manager.get(sessionId)).toMatchObject({ name: "nome", permissionMode: "plan" });
    expect((runtime as FakeRuntime).starts[0]).toMatchObject({
      model: "opus",
      permissionMode: "plan",
    });
  });
});

describe("permissão — broker", () => {
  const broker = () => {
    const store = new EventStore(":memory:");
    store.createSession({
      id: "s",
      name: null,
      cwd: "/",
      status: "running",
      permissionMode: "default",
      model: null,
    });
    const emitted: string[] = [];
    const b = new PermissionBroker(store, {
      emit: (_id, event) =>
        emitted.push(event.type === "permission.resolved" ? event.decision : event.type),
      onPendingChange: () => {},
    });
    return { b, store, emitted };
  };

  test("sinal de abort do runtime cancela o pedido aberto", async () => {
    const { b, emitted } = broker();
    const abort = new AbortController();
    const decision = b.request("s", "Bash", {}, abort.signal);
    expect(b.pendingCount("s")).toBe(1);
    abort.abort();
    expect(await decision).toEqual({ behavior: "deny", message: "cancelado" });
    expect(emitted).toEqual(["permission.requested", "cancelled"]);
  });

  test("sinal já abortado nega sem criar pedido", async () => {
    const { b, store } = broker();
    const abort = new AbortController();
    abort.abort();
    expect(await b.request("s", "Bash", {}, abort.signal)).toMatchObject({ behavior: "deny" });
    expect(store.pendingPermissions()).toHaveLength(0);
  });

  test("deny sem mensagem usa o texto padrão", async () => {
    const { b, emitted } = broker();
    const decision = b.request("s", "Bash", {}, new AbortController().signal);
    const [record] = (b as unknown as { open: Map<string, unknown> }).open.keys();
    b.respond({ requestId: String(record), decision: "deny" });
    expect(await decision).toEqual({ behavior: "deny", message: "Negado pelo usuário" });
    expect(emitted.at(-1)).toBe("deny");
  });
});
