import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { PACK_IDS } from "../../src/personas/pack.ts";
import { ClaudeSdkRuntime, type QueryFn } from "../../src/runtime/claude-sdk-runtime.ts";
import { startServer } from "../../src/server.ts";
import { newManager, workspace } from "../support/helpers.ts";
import { FrameClient } from "../support/history-helpers.ts";
import { cleanups, codeOf, SECURITY, setup, TOKEN, teardown } from "./subagent-setup.ts";

setDefaultTimeout(40_000);
afterEach(teardown);

describe("personas-subagente: o que vira agente", () => {
  test("toda persona que vale no projeto vira o agente persona-<id>, com descrição, corpo, ferramentas e modelo", async () => {
    const { personas, project } = setup();
    await personas.save({ scope: "host", persona: SECURITY });
    const { agents, untrusted } = await personas.subagents({ projectPath: project });
    // The nine of the pack, plus the host's own.
    expect(Object.keys(agents).sort()).toEqual(
      [...PACK_IDS, "seg"].map((id) => `persona-${id}`).sort(),
    );
    expect(untrusted).toEqual([]);
    expect(agents["persona-seg"]).toEqual({
      description: "Revisa segurança",
      prompt: "Procure injeção.",
      tools: ["Read", "Grep"],
      model: "claude-opus-5-5",
    });
    // A persona with no tools or model leaves them out: the agent inherits the session's.
    expect(agents["persona-docs"]).not.toHaveProperty("tools");
    expect(agents["persona-reviewer"]).toMatchObject({
      description: expect.stringContaining("Revisa legibilidade"),
      tools: ["Read", "Grep", "Glob", "Bash"],
      model: "claude-sonnet-5-5",
    });
    expect(agents["persona-qa"]?.prompt).toMatch(/engenheiro de QA sênior/);
  });

  test("a do projeto vale mais que a do host e a do pacote; sem confiança, fica de fora e é avisada", async () => {
    const { personas, project, writeProject } = setup();
    const hash = writeProject("reviewer", "Revisor do projeto", "Corpo do projeto.");
    writeProject("novo", "Novo", "Outro.");
    await personas.trust(project, "reviewer", hash);
    const { agents, untrusted } = await personas.subagents({ projectPath: project });
    expect(agents["persona-reviewer"]?.prompt).toBe("Corpo do projeto.");
    expect(agents).not.toHaveProperty("persona-novo");
    expect(untrusted).toEqual(["novo"]);
    // An untrusted project file does not even stand in for the pack's persona of the same id.
    writeProject("qa", "QA do projeto", "Corpo suspeito.");
    const again = await personas.subagents({ projectPath: project });
    expect(again.agents["persona-qa"]?.prompt).toMatch(/QA/);
    expect(again.agents["persona-qa"]?.prompt).not.toContain("suspeito");
    expect(again.untrusted.sort()).toEqual(["novo", "qa"]);
  });

  test("no idioma pedido, e fora das pastas permitidas só o host e o pacote", async () => {
    const { personas, root } = setup();
    expect((await personas.subagents({ language: "en" })).agents["persona-qa"]?.prompt).toMatch(
      /You act as a senior QA/,
    );
    expect(
      Object.keys((await personas.subagents({ projectPath: join(root, "..", "fora") })).agents),
    ).toHaveLength(14);
  });
});

describe("personas-subagente: sessão gerenciada", () => {
  test("a sessão ganha os agentes persona-<id> em toda execução, e sem o cadastro de personas não ganha nenhum", async () => {
    const { personas, root, project, store } = setup();
    const { manager, runtime, start } = newManager({ store, allowedRoots: [root], personas });
    cleanups.push(() => manager.shutdown());
    await start({ cwd: project, prompt: "oi" });
    const names = Object.keys(runtime.starts[0]?.agents ?? {});
    expect(names).toContain("persona-reviewer");
    expect(names).toHaveLength(14);
    expect(runtime.starts[0]?.agents?.["persona-security"]).toMatchObject({
      tools: ["Read", "Grep", "Glob", "Bash"],
      model: "claude-opus-5-5",
    });
    const bare = newManager();
    cleanups.push(() => bare.manager.shutdown());
    await bare.start({ cwd: bare.project, prompt: "oi" });
    expect(bare.runtime.starts[0]?.agents).toBeUndefined();
  });

  test("o runtime do SDK passa agents para o SDK, e sem eles nada muda", async () => {
    const seen: Options[] = [];
    const query: QueryFn = ({ options }) => {
      seen.push(options);
      return { async *[Symbol.asyncIterator]() {}, interrupt: async () => {}, close: () => {} };
    };
    const runtime = new ClaudeSdkRuntime({ query });
    const base = {
      cwd: "/w",
      permissionMode: "default" as const,
      env: {},
      canUseTool: async () => ({ behavior: "deny" as const, message: "x" }),
    };
    runtime.start({
      ...base,
      agents: { "persona-qa": { description: "d", prompt: "p", tools: ["Read"] } },
    });
    runtime.start(base);
    expect(seen[0]?.agents).toEqual({
      "persona-qa": { description: "d", prompt: "p", tools: ["Read"] },
    });
    expect("agents" in (seen[1] as Options)).toBe(false);
  });
});

describe("personas-subagente: publicar como agente do projeto", () => {
  test("pede confirmação antes de qualquer coisa, e grava pelo editor de agentes (ponto de extensão) o persona-<id>", async () => {
    const published: Array<{
      projectPath: string;
      name: string;
      description: string;
      prompt: string;
      tools?: string[];
      model?: string;
    }> = [];
    const { personas, project } = setup({
      publish: async (request) => {
        published.push(request);
        return { path: join(request.projectPath, ".claude", "agents", `${request.name}.md`) };
      },
    });
    expect(
      await codeOf(() =>
        personas.publishAgent({ id: "security", projectPath: project, confirm: false }),
      ),
    ).toBe("invalid_state");
    expect(published).toEqual([]);
    const done = await personas.publishAgent({
      id: "security",
      projectPath: project,
      confirm: true,
    });
    expect(done.path.endsWith("persona-security.md")).toBe(true);
    expect(published).toEqual([
      {
        projectPath: project,
        name: "persona-security",
        description: expect.stringContaining("Revisa mudanças"),
        prompt: expect.stringContaining("Não altere código"),
        tools: ["Read", "Grep", "Glob", "Bash"],
        model: "claude-opus-5-5",
      },
    ]);
    expect(
      await codeOf(() =>
        personas.publishAgent({ id: "nao-existe", projectPath: project, confirm: true }),
      ),
    ).toBe("not_found");
    expect(
      await codeOf(() =>
        personas.publishAgent({
          id: "qa",
          projectPath: join(project, "..", "..", "fora"),
          confirm: true,
        }),
      ),
    ).toBe("forbidden_cwd");
  });

  test("uma persona versionada sem confiança não se publica", async () => {
    const { personas, project, writeProject } = setup({ publish: async () => ({ path: "x" }) });
    writeProject("nova", "Nova", "Corpo.");
    expect(
      await codeOf(() =>
        personas.publishAgent({ id: "nova", projectPath: project, confirm: true }),
      ),
    ).toBe("persona_untrusted");
  });

  test("sem o editor de agentes (Fase 12) configurado, o pedido confirmado diz que falta", async () => {
    const { personas, project } = setup();
    expect(
      await codeOf(() => personas.publishAgent({ id: "qa", projectPath: project, confirm: true })),
    ).toBe("invalid_state");
    expect(
      await codeOf(() => personas.publishAgent({ id: "qa", projectPath: project, confirm: false })),
    ).toBe("invalid_state");
  });
});

describe("personas-subagente: pelo protocolo", () => {
  test("personas.subagents e personas.publishAgent", async () => {
    const published: string[] = [];
    const { personas, root, project, writeProject } = setup({
      publish: async (request) => {
        published.push(request.name);
        return { path: "p" };
      },
    });
    writeProject("nova", "Nova", "Corpo.");
    const { manager } = newManager();
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
    const code = async (type: string, payload: unknown) =>
      ((await client.request(type, payload)).error as { code?: string } | undefined)?.code ?? "ok";
    const result = await client.data<{ agents: Record<string, unknown>; untrusted: string[] }>(
      "personas.subagents",
      {
        projectPath: project,
        language: "en",
      },
    );
    expect(Object.keys(result?.agents ?? {})).toHaveLength(14);
    expect(result?.untrusted).toEqual(["nova"]);
    expect(
      await client.data("personas.publishAgent", { id: "qa", projectPath: project, confirm: true }),
    ).toEqual({ path: "p" });
    expect(published).toEqual(["persona-qa"]);
    expect(await code("personas.publishAgent", { id: "qa", projectPath: project })).toBe(
      "bad_request",
    );
    expect(
      await code("personas.publishAgent", { id: "qa", projectPath: project, confirm: false }),
    ).toBe("invalid_state");
  });

  test("sem as personas configuradas, os comandos dizem que está desativado", async () => {
    const { root } = workspace();
    const server = startServer({
      manager: newManager().manager,
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
    expect(await code("personas.subagents", {})).toBe("invalid_state");
    expect(
      await code("personas.publishAgent", { id: "qa", projectPath: "/x", confirm: true }),
    ).toBe("invalid_state");
  });
});
