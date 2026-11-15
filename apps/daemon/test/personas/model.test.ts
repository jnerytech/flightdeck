import { describe, expect, test } from "bun:test";
import {
  clampPermissionMode,
  normalizePersona,
  parsePersona,
  personaHash,
  restrictTools,
  serializePersona,
  toolAllowed,
} from "../../src/personas/domain/model.ts";
import { codeOf, input, SECURITY, scanner } from "./model-setup.ts";

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

  test("um arquivo malformado é recusado: sem frontmatter, sem fim, YAML ruim, campo faltando ou desconhecido", async () => {
    const bad = (source: string, fileId?: string) => codeOf(() => parsePersona(source, fileId));
    expect(await bad("só um texto")).toBe("bad_request");
    expect(await bad("---\nid: a\nname: A\ndescription: d\nsem fim\n")).toBe("bad_request");
    expect(await bad("---\nid: [quebrado\n---\ncorpo")).toBe("bad_request");
    expect(await bad("---\n- uma lista\n---\ncorpo")).toBe("bad_request");
    for (const missing of ["id", "name", "description"]) {
      const lines = ["id: a", "name: A", "description: d"].filter(
        (line) => !line.startsWith(missing),
      );
      expect([missing, await bad(`---\n${lines.join("\n")}\n---\ncorpo`)]).toEqual([
        missing,
        "bad_request",
      ]);
    }
    expect(await bad("---\nid: a\nname: A\ndescription: d\nextra: 1\n---\ncorpo")).toBe(
      "bad_request",
    );
    // The id of the file is the name of the file.
    expect(await bad(SECURITY, "outro")).toBe("bad_request");
    expect(await bad(SECURITY, "seguranca")).toBe("ok");
  });

  test("os campos têm regras: id simples (vira nome de arquivo e de agente), nome, descrição, ícone, modelo, esforço, ferramentas e modo", async () => {
    const bad = (extra: Record<string, unknown>) =>
      codeOf(() => normalizePersona(input(extra), scanner));
    for (const id of ["", "../x", "A", "a b", "-a", "a/b", "a.md", "x".repeat(41)]) {
      expect([id, await bad({ id })]).toEqual([id, "bad_request"]);
    }
    expect(await bad({ id: "a1-b2" })).toBe("ok");
    for (const name of ["", "x".repeat(61), "a\nb"])
      expect([name, await bad({ name })]).toEqual([name, "bad_request"]);
    for (const description of ["", "x".repeat(201), "linha 1\nlinha 2"]) {
      expect([description.slice(0, 5), await bad({ description })]).toEqual([
        description.slice(0, 5),
        "bad_request",
      ]);
    }
    for (const icon of ["Shield", "a b", "x".repeat(31)])
      expect([icon, await bad({ icon })]).toEqual([icon, "bad_request"]);
    for (const model of ["", "a b", "-x", "x".repeat(65)])
      expect([model, await bad({ model })]).toEqual([model, "bad_request"]);
    expect(await bad({ model: "claude-opus-5-5" })).toBe("ok");
    for (const effort of ["extremo", "", 3])
      expect([effort, await bad({ effort })]).toEqual([effort, "bad_request"]);
    for (const effort of ["low", "medium", "high", "xhigh", "max"])
      expect(await bad({ effort })).toBe("ok");
    for (const mode of ["bypassPermissions", "qualquer"])
      expect([mode, await bad({ permissionMode: mode })]).toEqual([mode, "bad_request"]);
    for (const mode of ["default", "acceptEdits", "plan", "dontAsk", "auto"]) {
      expect([mode, await bad({ permissionMode: mode })]).toEqual([mode, "ok"]);
    }
  });

  test("tools é uma lista de nomes de ferramenta, nunca uma regra de permissão", async () => {
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
      expect([JSON.stringify(tools).slice(0, 30), await bad(tools)]).toEqual([
        JSON.stringify(tools).slice(0, 30),
        "bad_request",
      ]);
    }
    expect(await bad(["Read", "Grep", "mcp__github__create_issue", "mcp__github"])).toBe("ok");
    // An empty list is a persona with no tools at all.
    expect(normalizePersona(input({ tools: [] }), scanner).tools).toEqual([]);
  });
});

describe("personas-modelo: o corpo", () => {
  test("até 8 KB (em bytes), sem caracteres de controle e sem corpo vazio", async () => {
    const bad = (body: string) => codeOf(() => normalizePersona(input({ body }), scanner));
    expect(await bad("x".repeat(8192))).toBe("ok");
    expect(await bad("x".repeat(8193))).toBe("bad_request");
    // Bytes, not characters: 4097 two-byte characters are 8194 bytes.
    expect(await bad("é".repeat(4096))).toBe("ok");
    expect(await bad("é".repeat(4097))).toBe("bad_request");
    expect(await bad("")).toBe("bad_request");
    expect(await bad("   \n  ")).toBe("bad_request");
    expect(await bad("linhas\ne\ttabs\r\nvalem")).toBe("ok");
    expect(await bad("escape\u001b[2J")).toBe("bad_request");
  });

  test("um segredo no corpo, no nome ou na descrição é recusado com o tipo e sem o valor", () => {
    const token = `ghp_${"0123456789abcdef".repeat(2)}0123`;
    const refused = (extra: Record<string, unknown>) => {
      try {
        normalizePersona(input(extra), scanner);
        return "ok";
      } catch (error) {
        const e = error as { code: string; message: string };
        return `${e.code}|${e.message.includes(token)}|${/github_token/.test(e.message)}`;
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
