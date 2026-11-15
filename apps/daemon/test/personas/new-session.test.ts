import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SessionManager } from "../../src/sessions/session-manager.ts";
import { poll, record } from "../support/helpers.ts";
import { cleanups, codeOf, REVIEWER, setup, teardown } from "./new-session-setup.ts";

// Real processes (flightdeckd, the fake claude): more than the default 5 s.
setDefaultTimeout(40_000);
afterEach(teardown);
describe("personas-sessao-nova: gerenciada", () => {
  test("a persona vira instruções acrescentadas, modelo, esforço e ferramentas pelo runtime, e o modo nunca passa do pedido", async () => {
    const { start, manager, runtime, project } = await setup();
    const { sessionId } = await start({
      cwd: project,
      prompt: "revise",
      persona: { id: "revisor-host" },
    });
    expect(runtime.starts).toHaveLength(1);
    expect(runtime.starts[0]).toMatchObject({
      cwd: project,
      model: "claude-opus-5-5",
      // plan is less permissive than the default the session asked for: the suggestion applies.
      permissionMode: "plan",
      persona: {
        append: "Você atua como revisor. Não altere código.",
        effort: "high",
        tools: ["Read", "Grep"],
      },
    });
    expect(manager.get(sessionId)).toMatchObject({
      model: "claude-opus-5-5",
      permissionMode: "plan",
      persona: { id: "revisor-host", name: "Revisor do host", icon: null },
    });
  });

  test("o pedido manda: modelo e modo explícitos valem, e uma persona mais permissiva não afrouxa o modo", async () => {
    const { start, manager, runtime, project, personas } = await setup();
    await personas.save({
      scope: "host",
      persona: {
        ...REVIEWER,
        id: "solta",
        permissionMode: "acceptEdits",
        model: "claude-opus-5-5",
      },
    });
    await start({
      cwd: project,
      prompt: "oi",
      persona: { id: "solta" },
      permissionMode: "default",
      model: "claude-sonnet-5-5",
    });
    expect(runtime.starts[0]).toMatchObject({
      model: "claude-sonnet-5-5",
      permissionMode: "default",
    });
    await start({
      cwd: project,
      prompt: "oi",
      persona: { id: "solta" },
      permissionMode: "plan",
    });
    expect(runtime.starts[1]?.permissionMode).toBe("plan");
  });

  test("uma persona do app vai inteira, e as regras valem do mesmo jeito", async () => {
    const { start, manager, runtime, project } = await setup();
    await start({
      cwd: project,
      prompt: "oi",
      persona: {
        definition: { id: "do-app", name: "Do app", description: "d", body: "Corpo do app." },
      },
    });
    expect(runtime.starts[0]?.persona).toMatchObject({ append: "Corpo do app." });
    const secret = `ghp_${"0123456789abcdef".repeat(2)}0123`;
    expect(
      await codeOf(() =>
        start({
          cwd: project,
          prompt: "oi",
          persona: { definition: { id: "ruim", name: "Ruim", description: "d", body: secret } },
        }),
      ),
    ).toBe("persona_secret");
    expect(manager.list()).toHaveLength(1);
  });

  test("uma persona do pacote vale no idioma pedido", async () => {
    const { start, manager, runtime, project } = await setup();
    await start({ cwd: project, prompt: "oi", persona: { id: "qa", language: "en" } });
    await start({ cwd: project, prompt: "oi", persona: { id: "qa" } });
    expect(runtime.starts[0]?.persona?.append).toMatch(/You act as a senior QA engineer/);
    expect(runtime.starts[1]?.persona?.append).toMatch(/engenheiro de QA sênior/);
    expect(runtime.starts[0]?.model).toBe("claude-sonnet-5-5");
  });

  test("falhas não deixam sessão: persona que não existe, versionada sem confiança, ou sem o cadastro de personas", async () => {
    const { start, manager, project } = await setup();
    expect(await codeOf(() => start({ cwd: project, prompt: "oi", persona: { id: "nada" } }))).toBe(
      "not_found",
    );
    const dir = join(project, ".flightdeck", "personas");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "do-projeto.md"),
      "---\nid: do-projeto\nname: P\ndescription: d\n---\nCorpo.\n",
    );
    expect(
      await codeOf(() => start({ cwd: project, prompt: "oi", persona: { id: "do-projeto" } })),
    ).toBe("persona_untrusted");
    expect(manager.list()).toEqual([]);
    const bare = await setup({ personas: false });
    expect(
      await codeOf(() => bare.start({ cwd: bare.project, prompt: "oi", persona: { id: "qa" } })),
    ).toBe("invalid_state");
    expect(bare.manager.list()).toEqual([]);
  });

  test("tools só restringe: uma ferramenta fora da lista é negada, uma da lista segue para a aprovação", async () => {
    const { start, manager, runtime, project } = await setup();
    const { sessionId } = await start({
      cwd: project,
      prompt: "oi",
      persona: { id: "revisor-host" },
    });
    const canUseTool = runtime.starts[0]?.canUseTool;
    const ctx = { signal: new AbortController().signal };
    const denied = await canUseTool?.("Write", { file_path: "a.ts" }, ctx);
    expect(denied).toMatchObject({ behavior: "deny" });
    expect((denied as { message: string }).message).toMatch(/Revisor do host/);
    expect((denied as { message: string }).message).toContain("does not use the tool Write");
    const mcp = await canUseTool?.("mcp__github__create_issue", {}, ctx);
    expect(mcp).toMatchObject({ behavior: "deny" });
    // A tool on the list is decided as usual: here it waits for the person.
    void canUseTool?.("Read", { file_path: "a.ts" }, ctx);
    const pending = await poll(() => manager.pendingPermissions(sessionId).length > 0);
    expect(pending).toBe(true);
    // And a session with no persona is not restricted at all.
    const plain = await start({ cwd: project, prompt: "oi" });
    void runtime.starts[1]?.canUseTool("Write", {}, ctx);
    expect(await poll(() => manager.pendingPermissions(plain.sessionId).length > 0)).toBe(true);
  });

  test("a persona acompanha a sessão: resumir, reabrir depois de reiniciar o daemon e o histórico mostram a mesma, mesmo se ela mudar depois", async () => {
    const { start, manager, runtime, project, personas, store, root } = await setup();
    const { sessionId } = await start({
      cwd: project,
      prompt: "oi",
      persona: { id: "revisor-host" },
    });
    const events = record(manager, sessionId);
    expect(events.find("session.created")[0]).toMatchObject({
      persona: { id: "revisor-host", name: "Revisor do host" },
    });
    await poll(() => events.statuses().includes("idle"));
    // The host edits the persona and then the session is closed and resumed.
    await personas.save({
      scope: "host",
      persona: { ...REVIEWER, body: "Outro corpo.", effort: "low" },
    });
    await manager.close(sessionId);
    await manager.resume(sessionId);
    expect(runtime.starts).toHaveLength(2);
    expect(runtime.starts[1]).toMatchObject({
      persona: {
        append: "Você atua como revisor. Não altere código.",
        effort: "high",
        tools: ["Read", "Grep"],
      },
      model: "claude-opus-5-5",
    });
    // A new daemon process over the same database reattaches lazily on the next message.
    await manager.shutdown();
    const second = new SessionManager({
      store,
      runtime,
      allowedRoots: [root],
      defaultPermissionMode: "default",
      allowApiKey: false,
      baseEnv: {},
    });
    cleanups.push(() => second.shutdown());
    store.updateSession(sessionId, { status: "idle" });
    second.send(sessionId, "continue");
    expect(runtime.starts).toHaveLength(3);
    expect(runtime.starts[2]?.persona?.append).toBe("Você atua como revisor. Não altere código.");
  });
});
