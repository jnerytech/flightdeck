import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Persona } from "@flightdeck/protocol";
import { PACK_IDS, packPersonas } from "../../src/personas/pack.ts";
import { Personas } from "../../src/personas/store.ts";
import { startServer } from "../../src/server.ts";
import { SecretScanner } from "../../src/snippets/model.ts";
import { EventStore } from "../../src/store/event-store.ts";
import { newManager, workspace } from "../support/helpers.ts";
import { FrameClient } from "../support/history-helpers.ts";

const TOKEN = "personas-pack-token-0123456789abcdef";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const scanner = new SecretScanner();
const SPEC_IDS = [
  "arquiteto",
  "seguranca",
  "qa",
  "sre",
  "performance",
  "revisor",
  "docs",
  // Issue #1961: the one that turns a request into an issue, right after docs.
  "specifier",
  "frontend",
  // Issue #1936: the two that judge the interface, right after the one that builds it.
  "ux",
  "ui",
  "dba",
  // Phase 21 coordinates its teams with this one.
  "coordenador",
  // Issue #92: the one that writes the code, the default worker of a team.
  "dev",
];

async function codeOf(fn: () => unknown): Promise<string> {
  try {
    await fn();
    return "ok";
  } catch (error) {
    return (error as { code?: string }).code ?? "sem código";
  }
}

describe("personas-pacote: as catorze", () => {
  test("são a desenvolvedora (issue #92), as nove da spec, na ordem da tabela, e a coordenadora dos times da Fase 21, nos dois idiomas", () => {
    expect(PACK_IDS).toEqual(SPEC_IDS);
    for (const language of ["pt-BR", "en"] as const) {
      expect([language, packPersonas(language).map((p) => p.id)]).toEqual([language, SPEC_IDS]);
    }
  });

  test("todas passam nas regras de uma persona (corpo até 8 KB, sem segredo) e são curtas, claras e com estrutura", () => {
    for (const language of ["pt-BR", "en"] as const) {
      for (const persona of packPersonas(language)) {
        const label = `${language}/${persona.id}`;
        // The pack is product text: it must pass the very rules the user's own personas do.
        expect([label, scanner.scan(persona.body)]).toEqual([label, []]);
        expect([label, Buffer.byteLength(persona.body) <= 3072]).toEqual([label, true]);
        expect([label, persona.body.length > 600]).toEqual([label, true]);
        expect([label, persona.description.length <= 200]).toEqual([label, true]);
        expect([
          label,
          persona.permissionMode === null || persona.permissionMode !== "bypassPermissions",
        ]).toEqual([label, true]);
        // Each one says how to work and how to answer, the two things the model needs.
        const sections = persona.body
          .split("\n")
          .filter((line) => /^[A-ZÀ-Ú][^-]*$/.test(line) && line.length < 40);
        expect([label, sections.length >= 2]).toEqual([label, true]);
      }
    }
  });

  test("os dois idiomas têm a mesma estrutura (ícone, modelo, esforço, ferramentas, modo) e textos próprios", () => {
    const pt = packPersonas("pt-BR");
    const en = packPersonas("en");
    for (const [i, persona] of pt.entries()) {
      const other = en[i] as (typeof en)[number];
      const label = persona.id;
      const structure = (p: typeof persona) => [
        p.icon,
        p.model,
        p.effort,
        p.tools,
        p.permissionMode,
      ];
      expect([label, structure(persona)]).toEqual([label, structure(other)]);
      expect([label, persona.body !== other.body]).toEqual([label, true]);
      expect([label, persona.description !== other.description]).toEqual([label, true]);
    }
    // The text really is in the language: the Portuguese one has accents, the English one has none.
    expect(pt.every((p) => /[ãçéíóú]/.test(p.body))).toBe(true);
    expect(en.every((p) => !/[ãçéíóú]/.test(p.body))).toBe(true);
  });

  test("a de segurança é a do exemplo da spec: só lê, em modo plan, com esforço alto", () => {
    const security = packPersonas("pt-BR").find((p) => p.id === "seguranca");
    expect(security).toMatchObject({
      name: "Revisor de segurança",
      icon: "shield",
      model: "claude-opus-5-5",
      effort: "high",
      tools: ["Read", "Grep", "Glob", "Bash"],
      permissionMode: "plan",
    });
    expect(security?.body).toMatch(/Não altere código/);
    // The ones that only read have no way to write.
    for (const id of ["seguranca", "revisor", "dba"]) {
      const tools = packPersonas("pt-BR").find((p) => p.id === id)?.tools ?? [];
      expect([id, tools.some((tool) => ["Write", "Edit", "NotebookEdit"].includes(tool))]).toEqual([
        id,
        false,
      ]);
    }
    expect(packPersonas("pt-BR").find((p) => p.id === "arquiteto")?.permissionMode).toBe("plan");
  });

  test("a ux recomenda e não altera código: Opus em esforço alto, só lê, com severidade, heurística, evidência e confiança (#1936)", () => {
    for (const language of ["pt-BR", "en"] as const) {
      const ux = packPersonas(language).find((p) => p.id === "ux");
      expect([language, ux?.model, ux?.effort, ux?.tools, ux?.permissionMode]).toEqual([
        language,
        "claude-opus-5-5",
        "high",
        ["Read", "Grep", "Glob", "Bash"],
        null,
      ]);
      const body = ux?.body ?? "";
      const must =
        language === "en"
          ? [
              /severity/i,
              /heuristic/i,
              /evidence/i,
              /confidence/i,
              /deterministic tools measure/i,
              /does not replace tests with real people/i,
              /off-token color.*ui/i,
            ]
          : [
              /severidade/i,
              /heurística/i,
              /evidência/i,
              /confiança/i,
              /ferramentas determinísticas medem/i,
              /não substitui testes com pessoas reais/i,
              /cor fora dos tokens.*ui/i,
            ];
      for (const rule of must)
        expect([language, String(rule), rule.test(body)]).toEqual([language, String(rule), true]);
    }
  });

  test("a ui aplica correções em PRs pequenos: Sonnet em esforço alto, sem lista de ferramentas, nomeia o token esperado em cada achado (#1936)", () => {
    for (const language of ["pt-BR", "en"] as const) {
      const ui = packPersonas(language).find((p) => p.id === "ui");
      expect([language, ui?.model, ui?.effort, ui?.tools, ui?.permissionMode]).toEqual([
        language,
        "claude-sonnet-5-5",
        "high",
        null,
        null,
      ]);
      const body = ui?.body ?? "";
      const must =
        language === "en"
          ? [
              /expected token/i,
              /small/i,
              /deterministic tools measure/i,
              /ambiguous label.*ux/i,
              /keyboard focus/i,
            ]
          : [
              /token esperado/i,
              /pequen/i,
              /ferramentas determinísticas medem/i,
              /rótulo ambíguo.*ux/i,
              /foco de teclado/i,
            ];
      for (const rule of must)
        expect([language, String(rule), rule.test(body)]).toEqual([language, String(rule), true]);
    }
  });

  test("the frontend persona builds the interface and leaves UX judgment to ux: no UX in its name, no UX eye in its text, same model and effort, and it names ux and ui (#1936)", () => {
    for (const language of ["pt-BR", "en"] as const) {
      const frontend = packPersonas(language).find((p) => p.id === "frontend");
      expect([language, frontend?.name, frontend?.model, frontend?.effort]).toEqual([
        language,
        "Frontend",
        "claude-sonnet-5-5",
        "medium",
      ]);
      const text = `${frontend?.description ?? ""}\n${frontend?.body ?? ""}`;
      const mustNot =
        language === "en"
          ? [/UX eye/i, /visual consistency/i, /\bUX\b/]
          : [/olhar de UX/i, /consistência visual/i, /\bUX\b/];
      for (const rule of mustNot)
        expect([language, String(rule), rule.test(text)]).toEqual([language, String(rule), false]);
      // The build rules stay.
      const body = frontend?.body ?? "";
      const must =
        language === "en"
          ? [
              /accessible name/i,
              /every state/i,
              /design system/i,
              /keyboard/i,
              /contrast/i,
              /narrow and wide/i,
              /reduced motion/i,
              /Split the work with the ux and ui personas/i,
            ]
          : [
              /nome acessível/i,
              /todos os estados/i,
              /sistema de design/i,
              /teclado/i,
              /contraste/i,
              /estreitas e largas/i,
              /movimento reduzido/i,
              /Divida o trabalho com as personas ux e ui/i,
            ];
      for (const rule of must)
        expect([language, String(rule), rule.test(body)]).toEqual([language, String(rule), true]);
    }
  });

  test("a desenvolvedora escreve código: teste primeiro, mudança pequena, segue o CLAUDE.md, roda as checagens e nunca faz push", () => {
    for (const language of ["pt-BR", "en"] as const) {
      const dev = packPersonas(language).find((p) => p.id === "dev");
      expect([language, dev?.name]).toEqual([
        language,
        language === "en" ? "Developer" : "Desenvolvedor",
      ]);
      // No tool list and no plan mode: it has to be able to edit and run.
      expect([language, dev?.tools, dev?.permissionMode]).toEqual([language, null, null]);
      const body = dev?.body ?? "";
      const must =
        language === "en"
          ? [/test first/i, /CLAUDE\.md/, /ADR/, /small/i, /never push/i, /checks/i]
          : [/teste primeiro/i, /CLAUDE\.md/, /ADR/, /pequen/i, /nunca faça push/i, /checagens/i];
      for (const rule of must)
        expect([language, String(rule), rule.test(body)]).toEqual([language, String(rule), true]);
    }
  });

  test("a especificadora transforma um pedido em issue: guarda as palavras da pessoa, não muda o pedido, critérios provados por comando, só lê e não roda código (#1961)", () => {
    for (const language of ["pt-BR", "en"] as const) {
      const specifier = packPersonas(language).find((p) => p.id === "specifier");
      expect([language, specifier?.name]).toEqual([
        language,
        language === "en" ? "Specifier" : "Especificador",
      ]);
      expect([
        language,
        specifier?.model,
        specifier?.effort,
        specifier?.tools,
        specifier?.permissionMode,
      ]).toEqual([language, "claude-sonnet-5-5", "high", ["Read", "Grep", "Glob", "Bash"], null]);
      // Right after docs, in both languages.
      const ids = packPersonas(language).map((p) => p.id);
      expect([language, ids[ids.indexOf("docs") + 1]]).toEqual([language, "specifier"]);
      const body = specifier?.body ?? "";
      const must =
        language === "en"
          ? [
              /verbatim/i,
              /never change what was asked/i,
              /provable by a command/i,
              /open question/i,
              /run no code/i,
              /How to work/,
              /How to answer/,
            ]
          : [
              /ao pé da letra/i,
              /nunca mude o que foi pedido/i,
              /provável por um comando/i,
              /pergunta em aberto/i,
              /não rode código/i,
              /Como trabalhar/,
              /Como responder/,
            ];
      for (const rule of must)
        expect([language, String(rule), rule.test(body)]).toEqual([language, String(rule), true]);
    }
    // The two languages agree on the fields that are not text, and the English body has no accents.
    const en = packPersonas("en").find((p) => p.id === "specifier");
    const pt = packPersonas("pt-BR").find((p) => p.id === "specifier");
    expect([en?.icon, en?.model, en?.effort, en?.tools]).toEqual([
      pt?.icon,
      pt?.model,
      pt?.effort,
      pt?.tools,
    ]);
    expect(/[À-ÿ]/.test(en?.body ?? "")).toBe(false);
  });

  test("o arquiteto desenha por domínio e responsabilidade única: módulos profundos, núcleo puro, sem ciclos, testes de comportamento (#1589)", () => {
    for (const language of ["pt-BR", "en"] as const) {
      const body = packPersonas(language).find((p) => p.id === "arquiteto")?.body ?? "";
      const must =
        language === "en"
          ? [
              /reason to change/i,
              /by domain, not by layer/i,
              /one public entry/i,
              /deep modules/i,
              /ports and adapters/i,
              /no dependency cycles/i,
              /observable behavior/i,
              /separate from behavior changes/i,
            ]
          : [
              /razão de mudar/i,
              /por domínio, não por camada/i,
              /uma única entrada pública/i,
              /módulos profundos/i,
              /portas e adaptadores/i,
              /sem ciclos de dependência/i,
              /comportamento observável/i,
              /separad[ao]s? das mudanças de comportamento/i,
            ];
      for (const rule of must)
        expect([language, String(rule), rule.test(body)]).toEqual([language, String(rule), true]);
    }
  });

  test("a coordenadora só lê e coordena: confere com o Bash, fala com as executoras pelo MCP do Flightdeck e não implementa", () => {
    for (const language of ["pt-BR", "en"] as const) {
      const coordinator = packPersonas(language).find((p) => p.id === "coordenador");
      expect([language, coordinator?.tools]).toEqual([
        language,
        ["Read", "Grep", "Glob", "Bash", "mcp__flightdeck"],
      ]);
      expect([language, coordinator?.model, coordinator?.effort]).toEqual([
        language,
        "claude-opus-5-5",
        "high",
      ]);
      for (const tool of ["send_to_session", "notify_when_idle", "team_status"]) {
        expect([language, tool, coordinator?.body.includes(tool)]).toEqual([language, tool, true]);
      }
    }
    const pt = packPersonas("pt-BR").find((p) => p.id === "coordenador");
    expect(pt?.name).toBe("Coordenador de time");
    expect(pt?.body).toMatch(/Não implemente/);
    expect(packPersonas("en").find((p) => p.id === "coordenador")?.body).toMatch(
      /Do not implement/,
    );
  });

  test("a coordenadora editada volta ao original com o restaurar", async () => {
    const { personas } = setup();
    await personas.save({ scope: "host", persona: edit("coordenador", "Coordene do meu jeito.") });
    expect((await personas.get("coordenador", {})).modified).toBe(true);
    expect(personas.reset("coordenador", {})).toMatchObject({
      id: "coordenador",
      scope: "pack",
      modified: false,
      name: "Coordenador de time",
    });
  });

  test("a lista é nova a cada pedido: mexer nela não muda o pacote", () => {
    const first = packPersonas("pt-BR");
    (first[0] as { body: string }).body = "alterado";
    first.pop();
    expect(packPersonas("pt-BR")).toHaveLength(14);
    expect(packPersonas("pt-BR")[0]?.body).not.toBe("alterado");
  });
});

function setup() {
  const { root, project } = workspace();
  const personas = new Personas({
    db: new EventStore(":memory:").db,
    allowedRoots: [root],
    scanner,
    pack: packPersonas,
  });
  return { root, project, personas };
}

const edit = (id: string, body: string) => ({
  id,
  name: "Minha versão",
  description: "Editada",
  body,
});

describe("personas-pacote: no daemon", () => {
  test("aparecem na lista do host, no idioma pedido (pt-BR quando não se pede), confiáveis e sem edição", async () => {
    const { personas } = setup();
    const listed = (await personas.list({ scope: "host" })).personas;
    expect(listed.map((p) => p.id)).toEqual(SPEC_IDS);
    expect(listed[0]).toMatchObject({
      scope: "pack",
      trusted: true,
      modified: false,
      hash: null,
      name: "Arquiteto",
    });
    expect(
      (await personas.list({ scope: "host", language: "en" })).personas.map((p) => p.name),
    ).toContain("Security reviewer");
    expect((await personas.get("seguranca", {})).name).toBe("Revisor de segurança");
    expect((await personas.get("seguranca", { language: "en" })).name).toBe("Security reviewer");
    expect((await personas.resolve({ id: "qa" }, { language: "en" })).persona.body).toMatch(
      /You act as a senior QA engineer/,
    );
    expect(await personas.resolve({ id: "qa" }, {})).toMatchObject({ source: "pack", hash: null });
  });

  test("editar guarda a versão do host no lugar da do pacote, nos dois idiomas; restaurar volta ao original", async () => {
    const { personas } = setup();
    const saved = await personas.save({
      scope: "host",
      persona: edit("revisor", "Revise só o que mudou."),
    });
    expect(saved).toMatchObject({ id: "revisor", scope: "host", modified: true });
    const revisor = async (language?: "pt-BR" | "en") =>
      (await personas.list({ scope: "host", ...(language ? { language } : {}) })).personas.filter(
        (p) => p.id === "revisor",
      );
    // One entry per id: the edited one stands in for the pack's, whatever the language.
    expect((await revisor()).map((p) => p.body)).toEqual(["Revise só o que mudou."]);
    expect((await revisor("en")).map((p) => p.body)).toEqual(["Revise só o que mudou."]);
    expect((await personas.list({ scope: "host" })).personas).toHaveLength(14);
    expect((await personas.resolve({ id: "revisor" }, {})).persona.body).toBe(
      "Revise só o que mudou.",
    );
    const restored = personas.reset("revisor", {});
    expect(restored).toMatchObject({
      id: "revisor",
      scope: "pack",
      modified: false,
      name: "Revisor de código",
    });
    expect((await personas.get("revisor", { language: "en" })).name).toBe("Code reviewer");
    // Resetting what is not edited is fine; what is not in the pack has nothing to go back to.
    expect(personas.reset("revisor", {}).scope).toBe("pack");
    await personas.save({ scope: "host", persona: edit("minha", "Uma minha.") });
    expect(await codeOf(() => personas.reset("minha", {}))).toBe("bad_request");
    expect((await personas.get("minha", {})).scope).toBe("host");
  });

  test("uma do pacote não se remove; a editada se remove restaurando, e uma que só o host tem se remove de vez", async () => {
    const { personas } = setup();
    expect(await codeOf(() => personas.remove("host", "qa"))).toBe("not_found");
    await personas.save({ scope: "host", persona: edit("qa", "Meu QA.") });
    await personas.remove("host", "qa");
    expect((await personas.get("qa", {})).scope).toBe("pack");
    await personas.save({ scope: "host", persona: edit("minha", "Uma minha.") });
    await personas.remove("host", "minha");
    expect((await personas.list({ scope: "host" })).personas).toHaveLength(14);
  });

  test("a edição vale as regras de sempre, e a do projeto vale mais que a editada e que a do pacote", async () => {
    const { personas, project } = setup();
    const secret = `ghp_${"0123456789abcdef".repeat(2)}0123`;
    expect(
      await codeOf(() => personas.save({ scope: "host", persona: edit("qa", `Use ${secret}`) })),
    ).toBe("persona_secret");
    expect((await personas.get("qa", {})).scope).toBe("pack");
    await personas.save({ scope: "host", persona: edit("qa", "Do host.") });
    await personas.save({
      scope: "project",
      projectPath: project,
      persona: edit("qa", "Do projeto."),
    });
    expect((await personas.get("qa", { projectPath: project })).body).toBe("Do projeto.");
    expect((await personas.get("qa", {})).body).toBe("Do host.");
    // A project persona that is not trusted is never used in place of the pack's, it is refused.
    const dir = join(project, ".flightdeck", "personas");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "sre.md"),
      "---\nid: sre\nname: Do projeto\ndescription: d\n---\nCorpo.\n",
    );
    expect(await codeOf(() => personas.resolve({ id: "sre" }, { projectPath: project }))).toBe(
      "persona_untrusted",
    );
  });
});

describe("personas-pacote: pelo protocolo", () => {
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

  test("personas.list com language e personas.reset", async () => {
    const { personas, root } = setup();
    const { client, codeOfCall } = await connect(personas, root);
    const english = await client.data<{ personas: Persona[] }>("personas.list", {
      scope: "host",
      language: "en",
    });
    expect(english?.personas.map((p) => p.name)).toContain("Architect");
    await client.data("personas.save", { scope: "host", persona: edit("sre", "Meu SRE.") });
    expect(await client.data("personas.reset", { id: "sre", language: "en" })).toMatchObject({
      id: "sre",
      scope: "pack",
      name: "SRE / DevOps",
    });
    expect(await codeOfCall("personas.reset", { id: "nada" })).toBe("bad_request");
    expect(await codeOfCall("personas.reset", { id: "sre", language: "fr" })).toBe("bad_request");
    expect(await codeOfCall("personas.list", { language: "fr" })).toBe("bad_request");
  });

  test("sem as personas configuradas, reset diz que está desativado", async () => {
    const { root } = workspace();
    const { codeOfCall } = await connect(null, root);
    expect(await codeOfCall("personas.reset", { id: "qa" })).toBe("invalid_state");
  });
});
