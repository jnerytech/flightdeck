import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Persona, PersonaInput } from "@flightdeck/protocol";
import {
  clampPermissionMode,
  normalizePersona,
  parsePersona,
  personaHash,
  restrictTools,
  serializePersona,
  toolAllowed,
} from "../src/personas/model.ts";
import { Personas } from "../src/personas/store.ts";
import { startServer } from "../src/server.ts";
import { SecretScanner } from "../src/snippets/model.ts";
import { EventStore } from "../src/store/event-store.ts";
import { newManager, workspace } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

const TOKEN = "personas-token-0123456789abcdef0123";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const scanner = new SecretScanner();

const SECURITY = [
  "---",
  "id: seguranca",
  "name: Revisor de segurança",
  "description: Revisa mudanças procurando falhas de segurança e explica o risco de cada uma",
  "icon: shield",
  "model: claude-opus-5-5",
  "effort: high",
  "tools: [Read, Grep, Glob, Bash]",
  "permissionMode: plan",
  "---",
  "Você atua como revisor de segurança sênior.",
  "- Procure injeção (SQL, comando, caminho), segredos expostos, validação faltando.",
  "- Classifique cada achado por gravidade e mostre a linha.",
  "- Não altere código: proponha a correção.",
  "",
].join("\n");

/** The error code of a call that is expected to fail. */
function codeOf(fn: () => unknown): string {
  try {
    fn();
    return "ok";
  } catch (error) {
    return (error as { code?: string }).code ?? "sem código";
  }
}

const input = (extra: Record<string, unknown> = {}): PersonaInput =>
  ({
    id: "revisor",
    name: "Revisor",
    description: "Revisa código",
    body: "Revise o código com cuidado.",
    ...extra,
  }) as PersonaInput;

describe("personas-modelo: o arquivo", () => {
  test("lê o frontmatter e o corpo do exemplo da spec, com CRLF também, e o que se escreve volta igual", () => {
    const persona = parsePersona(SECURITY, "seguranca");
    expect(persona).toEqual({
      id: "seguranca",
      name: "Revisor de segurança",
      description: "Revisa mudanças procurando falhas de segurança e explica o risco de cada uma",
      icon: "shield",
      model: "claude-opus-5-5",
      effort: "high",
      tools: ["Read", "Grep", "Glob", "Bash"],
      permissionMode: "plan",
      body: [
        "Você atua como revisor de segurança sênior.",
        "- Procure injeção (SQL, comando, caminho), segredos expostos, validação faltando.",
        "- Classifique cada achado por gravidade e mostre a linha.",
        "- Não altere código: proponha a correção.",
      ].join("\n"),
    });
    expect(parsePersona(SECURITY.replaceAll("\n", "\r\n"), "seguranca")).toEqual(persona);
    expect(parsePersona(serializePersona(persona), "seguranca")).toEqual(persona);
    // The optional fields are really optional.
    const minimal = parsePersona("---\nid: qa\nname: QA\ndescription: Testes\n---\nTeste tudo.\n");
    expect(minimal).toMatchObject({
      icon: null,
      model: null,
      effort: null,
      tools: null,
      permissionMode: null,
    });
    expect(parsePersona(serializePersona(minimal))).toEqual(minimal);
  });

  test("um arquivo malformado é recusado: sem frontmatter, sem fim, YAML ruim, campo faltando ou desconhecido", () => {
    const bad = (source: string, fileId?: string) => codeOf(() => parsePersona(source, fileId));
    expect(bad("só um texto")).toBe("bad_request");
    expect(bad("---\nid: a\nname: A\ndescription: d\nsem fim\n")).toBe("bad_request");
    expect(bad("---\nid: [quebrado\n---\ncorpo")).toBe("bad_request");
    expect(bad("---\n- uma lista\n---\ncorpo")).toBe("bad_request");
    for (const missing of ["id", "name", "description"]) {
      const lines = ["id: a", "name: A", "description: d"].filter(
        (line) => !line.startsWith(missing),
      );
      expect([missing, bad(`---\n${lines.join("\n")}\n---\ncorpo`)]).toEqual([
        missing,
        "bad_request",
      ]);
    }
    expect(bad("---\nid: a\nname: A\ndescription: d\nextra: 1\n---\ncorpo")).toBe("bad_request");
    // The id of the file is the name of the file.
    expect(bad(SECURITY, "outro")).toBe("bad_request");
    expect(bad(SECURITY, "seguranca")).toBe("ok");
  });

  test("os campos têm regras: id simples (vira nome de arquivo e de agente), nome, descrição, ícone, modelo, esforço, ferramentas e modo", () => {
    const bad = (extra: Record<string, unknown>) =>
      codeOf(() => normalizePersona(input(extra), scanner));
    for (const id of ["", "../x", "A", "a b", "-a", "a/b", "a.md", "x".repeat(41)]) {
      expect([id, bad({ id })]).toEqual([id, "bad_request"]);
    }
    expect(bad({ id: "a1-b2" })).toBe("ok");
    for (const name of ["", "x".repeat(61), "a\nb"])
      expect([name, bad({ name })]).toEqual([name, "bad_request"]);
    for (const description of ["", "x".repeat(201), "linha 1\nlinha 2"]) {
      expect([description.slice(0, 5), bad({ description })]).toEqual([
        description.slice(0, 5),
        "bad_request",
      ]);
    }
    for (const icon of ["Shield", "a b", "x".repeat(31)])
      expect([icon, bad({ icon })]).toEqual([icon, "bad_request"]);
    for (const model of ["", "a b", "-x", "x".repeat(65)])
      expect([model, bad({ model })]).toEqual([model, "bad_request"]);
    expect(bad({ model: "claude-opus-5-5" })).toBe("ok");
    for (const effort of ["extremo", "", 3])
      expect([effort, bad({ effort })]).toEqual([effort, "bad_request"]);
    for (const effort of ["low", "medium", "high", "xhigh", "max"])
      expect(bad({ effort })).toBe("ok");
    for (const mode of ["bypassPermissions", "qualquer"])
      expect([mode, bad({ permissionMode: mode })]).toEqual([mode, "bad_request"]);
    for (const mode of ["default", "acceptEdits", "plan", "dontAsk", "auto"]) {
      expect([mode, bad({ permissionMode: mode })]).toEqual([mode, "ok"]);
    }
  });

  test("tools é uma lista de nomes de ferramenta, nunca uma regra de permissão", () => {
    const bad = (tools: unknown) => codeOf(() => normalizePersona(input({ tools }), scanner));
    for (const tools of [
      ["Bash(rm:*)"],
      ["Read", "Read"],
      ["a b"],
      [""],
      ["Read,Grep"],
      "Read",
      [1],
      Array.from({ length: 51 }, (_, i) => `T${i}`),
    ]) {
      expect([JSON.stringify(tools).slice(0, 30), bad(tools)]).toEqual([
        JSON.stringify(tools).slice(0, 30),
        "bad_request",
      ]);
    }
    expect(bad(["Read", "Grep", "mcp__github__create_issue", "mcp__github"])).toBe("ok");
    // An empty list is a persona with no tools at all.
    expect(normalizePersona(input({ tools: [] }), scanner).tools).toEqual([]);
  });
});

describe("personas-modelo: o corpo", () => {
  test("até 8 KB (em bytes), sem caracteres de controle e sem corpo vazio", () => {
    const bad = (body: string) => codeOf(() => normalizePersona(input({ body }), scanner));
    expect(bad("x".repeat(8192))).toBe("ok");
    expect(bad("x".repeat(8193))).toBe("bad_request");
    // Bytes, not characters: 4097 two-byte characters are 8194 bytes.
    expect(bad("é".repeat(4096))).toBe("ok");
    expect(bad("é".repeat(4097))).toBe("bad_request");
    expect(bad("")).toBe("bad_request");
    expect(bad("   \n  ")).toBe("bad_request");
    expect(bad("linhas\ne\ttabs\r\nvalem")).toBe("ok");
    expect(bad("escape\u001b[2J")).toBe("bad_request");
  });

  test("um segredo no corpo, no nome ou na descrição é recusado com o tipo e sem o valor", () => {
    const token = `ghp_${"0123456789abcdef".repeat(2)}0123`;
    const refused = (extra: Record<string, unknown>) => {
      try {
        normalizePersona(input(extra), scanner);
        return "ok";
      } catch (error) {
        const e = error as { code: string; message: string };
        return `${e.code}|${e.message.includes(token)}|${/token do GitHub/.test(e.message)}`;
      }
    };
    expect(refused({ body: `Use o token ${token} nas chamadas.` })).toBe(
      "persona_secret|false|true",
    );
    expect(refused({ description: `Com ${token}` })).toBe("persona_secret|false|true");
    expect(refused({ name: token })).toBe("persona_secret|false|true");
    expect(refused({ body: "Procure password=hunter2 em exemplos" })).toMatch(
      /^persona_secret\|false\|false$/,
    );
    // Talking about secrets is fine; having one is not.
    expect(refused({ body: "Procure segredos expostos, senhas e tokens no código." })).toBe("ok");
  });
});

describe("personas-modelo: ferramentas e modo só restringem", () => {
  test("a persona nunca libera uma ferramenta que a sessão não teria", () => {
    // No list means the session's own.
    expect(restrictTools(null, null)).toBeNull();
    expect(restrictTools(null, ["Read", "Write"])).toEqual(["Read", "Write"]);
    // A list is the most that can be used: the intersection with what the session has.
    expect(restrictTools(["Read", "Grep"], ["Read", "Write"])).toEqual(["Read"]);
    expect(restrictTools(["Read", "Grep"], null)).toEqual(["Read", "Grep"]);
    expect(restrictTools(["Bash"], [])).toEqual([]);
    expect(restrictTools([], ["Read"])).toEqual([]);
  });

  test("toolAllowed: sem lista tudo, com lista só o que está nela (um servidor MCP inteiro se o nome dele está)", () => {
    expect(toolAllowed(null, "Bash")).toBe(true);
    expect(toolAllowed(["Read", "Grep"], "Read")).toBe(true);
    expect(toolAllowed(["Read", "Grep"], "Bash")).toBe(false);
    expect(toolAllowed([], "Read")).toBe(false);
    expect(toolAllowed(["mcp__github__create_issue"], "mcp__github__create_issue")).toBe(true);
    expect(toolAllowed(["mcp__github__create_issue"], "mcp__github__delete_repo")).toBe(false);
    expect(toolAllowed(["mcp__github"], "mcp__github__delete_repo")).toBe(true);
    expect(toolAllowed(["mcp__github"], "mcp__githubx__tool")).toBe(false);
  });

  test("o modo da persona só vale se for menos permissivo que o da sessão; sem ordem clara, prevalece o da sessão", () => {
    // plan < dontAsk < default < acceptEdits and auto (not comparable) < bypassPermissions
    expect(clampPermissionMode(null, "default")).toBe("default");
    expect(clampPermissionMode("plan", "default")).toBe("plan");
    expect(clampPermissionMode("plan", "acceptEdits")).toBe("plan");
    expect(clampPermissionMode("plan", "bypassPermissions")).toBe("plan");
    expect(clampPermissionMode("dontAsk", "default")).toBe("dontAsk");
    expect(clampPermissionMode("default", "bypassPermissions")).toBe("default");
    expect(clampPermissionMode("default", "auto")).toBe("default");
    // More permissive than the session's, or the same: the session's.
    expect(clampPermissionMode("acceptEdits", "default")).toBe("default");
    expect(clampPermissionMode("auto", "plan")).toBe("plan");
    expect(clampPermissionMode("default", "default")).toBe("default");
    expect(clampPermissionMode("default", "plan")).toBe("plan");
    // acceptEdits and auto cannot be told apart: the suggestion does not apply.
    expect(clampPermissionMode("acceptEdits", "auto")).toBe("auto");
    expect(clampPermissionMode("auto", "acceptEdits")).toBe("acceptEdits");
    expect(clampPermissionMode("plan", "plan")).toBe("plan");
  });

  test("o hash é o do arquivo: igual para o mesmo texto, outro para qualquer mudança", () => {
    expect(personaHash(SECURITY)).toMatch(/^[0-9a-f]{64}$/);
    expect(personaHash(SECURITY)).toBe(personaHash(SECURITY));
    expect(personaHash(SECURITY)).not.toBe(personaHash(`${SECURITY}x`));
  });
});

function setup() {
  const { root, project } = workspace();
  const clock = Date.parse("2026-10-29T12:00:00Z");
  const store = new EventStore(":memory:");
  const personas = new Personas({ db: store.db, allowedRoots: [root], scanner, now: () => clock });
  const dir = join(project, ".flightdeck", "personas");
  const writeFile = (id: string, source: string) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${id}.md`), source);
  };
  return { root, project, personas, dir, writeFile };
}

describe("personas-modelo: do host", () => {
  test("salvar, listar, buscar, atualizar e remover; salvar com o mesmo id atualiza", () => {
    const { personas } = setup();
    const saved = personas.save({ scope: "host", persona: input() });
    expect(saved).toMatchObject({
      id: "revisor",
      scope: "host",
      source: "host",
      trusted: true,
      hash: null,
    });
    expect(personas.list({ scope: "host" }).personas.map((p) => p.id)).toEqual(["revisor"]);
    expect(personas.get("revisor", {}).body).toBe("Revise o código com cuidado.");
    expect(personas.save({ scope: "host", persona: input({ body: "Outro corpo." }) }).body).toBe(
      "Outro corpo.",
    );
    expect(personas.list({ scope: "host" }).personas).toHaveLength(1);
    personas.remove("host", "revisor");
    expect(personas.list({ scope: "host" }).personas).toEqual([]);
    expect(codeOf(() => personas.get("revisor", {}))).toBe("not_found");
    expect(codeOf(() => personas.remove("host", "revisor"))).toBe("not_found");
    expect(
      codeOf(() =>
        personas.save({
          scope: "host",
          persona: input({ body: "ghp_0123456789abcdef0123456789abcdef0123" }),
        }),
      ),
    ).toBe("persona_secret");
  });
});

describe("personas-modelo: do projeto, versionadas", () => {
  test("carrega os arquivos de .flightdeck/personas, e as ruins ficam de fora com o motivo", () => {
    const { personas, project, writeFile } = setup();
    expect(personas.list({ scope: "project", projectPath: project })).toEqual({
      personas: [],
      project: null,
    });
    writeFile("seguranca", SECURITY);
    writeFile("ruim", "sem frontmatter");
    writeFile("outro-nome", SECURITY);
    const listed = personas.list({ scope: "project", projectPath: project });
    expect(listed.personas.map((p) => p.id)).toEqual(["seguranca"]);
    expect(listed.personas[0]).toMatchObject({
      scope: "project",
      source: "project",
      trusted: false,
    });
    expect(listed.personas[0]?.hash).toBe(personaHash(SECURITY));
    expect(listed.project?.errors).toHaveLength(2);
    expect(listed.project?.errors.join("|")).toMatch(/ruim/);
    expect(listed.project?.errors.join("|")).toMatch(/outro-nome/);
    expect(codeOf(() => personas.list({ scope: "project" }))).toBe("bad_request");
    expect(
      codeOf(() =>
        personas.list({ scope: "project", projectPath: join(project, "..", "..", "fora") }),
      ),
    ).toBe("forbidden_cwd");
  });

  test("antes do primeiro uso pedem confiança pelo hash; mudar o arquivo tira a confiança", () => {
    const { personas, project, writeFile } = setup();
    writeFile("seguranca", SECURITY);
    const ctx = { projectPath: project };
    expect(codeOf(() => personas.resolve({ id: "seguranca" }, ctx))).toBe("persona_untrusted");
    expect(codeOf(() => personas.trust(project, "seguranca", "0".repeat(64)))).toBe(
      "invalid_state",
    );
    expect(codeOf(() => personas.trust(project, "nao-existe", personaHash(SECURITY)))).toBe(
      "not_found",
    );
    const trusted = personas.trust(project, "seguranca", personaHash(SECURITY));
    expect(trusted).toMatchObject({ id: "seguranca", trusted: true });
    expect(personas.resolve({ id: "seguranca" }, ctx).persona.name).toBe("Revisor de segurança");
    // Changed: another hash, not trusted anymore. Back to the old text: trusted again.
    writeFile("seguranca", SECURITY.replace("sênior", "sênior e atento"));
    expect(codeOf(() => personas.resolve({ id: "seguranca" }, ctx))).toBe("persona_untrusted");
    writeFile("seguranca", SECURITY);
    expect(personas.resolve({ id: "seguranca" }, ctx).persona.id).toBe("seguranca");
  });

  test("salvar no projeto escreve o arquivo com o id no nome, confia no que o próprio app salvou e recusa segredo sem escrever nada", () => {
    const { personas, project, dir } = setup();
    const saved = personas.save({
      scope: "project",
      projectPath: project,
      persona: input({ id: "revisor" }),
    });
    expect(saved).toMatchObject({ scope: "project", trusted: true });
    const file = join(dir, "revisor.md");
    expect(parsePersona(readFileSync(file, "utf8"), "revisor").name).toBe("Revisor");
    expect(saved.hash).toBe(personaHash(readFileSync(file, "utf8")));
    const secret = `ghp_${"0123456789abcdef".repeat(2)}0123`;
    expect(
      codeOf(() =>
        personas.save({
          scope: "project",
          projectPath: project,
          persona: input({ id: "novo", body: secret }),
        }),
      ),
    ).toBe("persona_secret");
    expect(existsSync(join(dir, "novo.md"))).toBe(false);
    expect(codeOf(() => personas.save({ scope: "project", persona: input() }))).toBe("bad_request");
    personas.remove("project", "revisor", project);
    expect(existsSync(file)).toBe(false);
    expect(codeOf(() => personas.remove("project", "revisor", project))).toBe("not_found");
  });

  test("a do projeto vale mais que a do host, e a do host serve onde o projeto não tem", () => {
    const { personas, project } = setup();
    personas.save({ scope: "host", persona: input({ body: "Do host." }) });
    personas.save({ scope: "host", persona: input({ id: "so-host", body: "Só do host." }) });
    personas.save({
      scope: "project",
      projectPath: project,
      persona: input({ body: "Do projeto." }),
    });
    expect(personas.get("revisor", { projectPath: project }).body).toBe("Do projeto.");
    expect(personas.get("revisor", {}).body).toBe("Do host.");
    expect(personas.get("so-host", { projectPath: project }).body).toBe("Só do host.");
    expect(
      personas
        .list({ projectPath: project })
        .personas.map((p) => `${p.scope}:${p.id}`)
        .sort(),
    ).toEqual(["host:revisor", "host:so-host", "project:revisor"]);
  });

  test("resolver uma definição inline (a persona do app) vale as mesmas regras e não pede confiança", () => {
    const { personas } = setup();
    const resolved = personas.resolve(
      { definition: input({ permissionMode: "plan", tools: ["Read"] }) },
      {},
    );
    expect(resolved).toMatchObject({
      persona: { id: "revisor", permissionMode: "plan", tools: ["Read"] },
      source: "inline",
    });
    expect(codeOf(() => personas.resolve({ definition: input({ body: "" }) }, {}))).toBe(
      "bad_request",
    );
    expect(
      codeOf(() =>
        personas.resolve({ definition: input({ permissionMode: "bypassPermissions" }) }, {}),
      ),
    ).toBe("bad_request");
    expect(codeOf(() => personas.resolve({}, {}))).toBe("bad_request");
    expect(codeOf(() => personas.resolve({ id: "nao-existe" }, {}))).toBe("not_found");
  });
});

describe("personas-modelo: pelo protocolo", () => {
  async function connect(personas: Personas | null, root: string) {
    const server = startServer({
      manager: newManager().manager,
      ...(personas ? { personas } : {}),
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
    const codeOfCall = async (type: string, payload: unknown) =>
      ((await client.request(type, payload)).error as { code?: string } | undefined)?.code ?? "ok";
    return { client, codeOfCall };
  }

  test("personas.list, save, remove e trust", async () => {
    const { personas, root, project, writeFile } = setup();
    const { client, codeOfCall } = await connect(personas, root);
    const saved = await client.data<Persona>("personas.save", { scope: "host", persona: input() });
    expect(saved?.id).toBe("revisor");
    expect(await client.data("personas.list", { scope: "host" })).toMatchObject({
      personas: [{ id: "revisor" }],
    });
    writeFile("seguranca", SECURITY);
    const listed = await client.data<{ personas: Array<{ id: string; hash: string }> }>(
      "personas.list",
      { scope: "project", projectPath: project },
    );
    const hash = listed?.personas[0]?.hash ?? "";
    expect(
      await client.data("personas.trust", { projectPath: project, id: "seguranca", hash }),
    ).toMatchObject({ trusted: true });
    expect(await codeOfCall("personas.save", { scope: "host", persona: input({ extra: 1 }) })).toBe(
      "bad_request",
    );
    expect(
      await codeOfCall("personas.save", {
        scope: "host",
        persona: input({ body: "ghp_0123456789abcdef0123456789abcdef0123" }),
      }),
    ).toBe("persona_secret");
    expect(await codeOfCall("personas.remove", { scope: "host", id: "revisor" })).toBe("ok");
    expect(await codeOfCall("personas.remove", { scope: "host", id: "revisor" })).toBe("not_found");
  });

  test("sem as personas configuradas, os comandos dizem que está desativado", async () => {
    const { root } = workspace();
    const { codeOfCall } = await connect(null, root);
    for (const [type, payload] of [
      ["personas.list", {}],
      ["personas.save", { scope: "host", persona: input() }],
      ["personas.remove", { scope: "host", id: "x" }],
      ["personas.trust", { projectPath: "/x", id: "x", hash: "h" }],
    ] as const) {
      expect([type, await codeOfCall(type, payload)]).toEqual([type, "invalid_state"]);
    }
  });
});
