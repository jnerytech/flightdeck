import { describe, expect, test } from "bun:test";
import { PACK_IDS, packPersonas } from "../../src/personas/pack.ts";
import { edit, SPEC_IDS, scanner, setup } from "./package-setup.ts";

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
    const security = packPersonas("pt-BR").find((p) => p.id === "security");
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
    for (const id of ["security", "reviewer", "dba"]) {
      const tools = packPersonas("pt-BR").find((p) => p.id === id)?.tools ?? [];
      expect([id, tools.some((tool) => ["Write", "Edit", "NotebookEdit"].includes(tool))]).toEqual([
        id,
        false,
      ]);
    }
    expect(packPersonas("pt-BR").find((p) => p.id === "architect")?.permissionMode).toBe("plan");
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
      const body = packPersonas(language).find((p) => p.id === "architect")?.body ?? "";
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
      const coordinator = packPersonas(language).find((p) => p.id === "coordinator");
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
    const pt = packPersonas("pt-BR").find((p) => p.id === "coordinator");
    expect(pt?.name).toBe("Coordenador de time");
    expect(pt?.body).toMatch(/Não implemente/);
    expect(packPersonas("en").find((p) => p.id === "coordinator")?.body).toMatch(
      /Do not implement/,
    );
  });

  test("a coordenadora editada volta ao original com o restaurar", async () => {
    const { personas } = setup();
    await personas.save({ scope: "host", persona: edit("coordinator", "Coordene do meu jeito.") });
    expect((await personas.get("coordinator", {})).modified).toBe(true);
    expect(personas.reset("coordinator", {})).toMatchObject({
      id: "coordinator",
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
