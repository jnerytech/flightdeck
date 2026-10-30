import { describe, expect, test } from "bun:test";
import { getField, parseDocument, serialize, setField } from "../src/lib/frontmatter.ts";

const AGENT = `---
name: revisor
description: Revisa o diff antes do commit
tools: Read, Grep
model: sonnet
---
Você revisa código.
`;

describe("agente-frontmatter", () => {
  test("lê os campos e o corpo", () => {
    const doc = parseDocument(AGENT);
    expect(getField(doc, "name")).toBe("revisor");
    expect(getField(doc, "description")).toBe("Revisa o diff antes do commit");
    expect(getField(doc, "tools")).toBe("Read, Grep");
    expect(getField(doc, "model")).toBe("sonnet");
    expect(getField(doc, "color")).toBeUndefined();
    expect(doc.body).toBe("Você revisa código.\n");
  });

  test("sem frontmatter, tudo é corpo e nada vira campo", () => {
    const doc = parseDocument("# só texto\n");
    expect(doc.entries).toEqual([]);
    expect(doc.body).toBe("# só texto\n");
    expect(serialize(doc)).toBe("# só texto\n");
  });

  test("sem mudar nada, o arquivo volta idêntico: aspas, listas, blocos e fim de linha", () => {
    const content = [
      "---",
      'name: "com: dois pontos"',
      "description: >",
      "  uma linha",
      "  outra linha",
      "tools: [Read, Grep]",
      "color: blue",
      "---",
      "corpo",
      "",
    ];
    for (const eol of ["\n", "\r\n"]) {
      const text = content.join(eol);
      expect(serialize(parseDocument(text))).toBe(text);
    }
    const doc = parseDocument(content.join("\n"));
    expect(getField(doc, "name")).toBe("com: dois pontos");
    expect(getField(doc, "tools")).toBe("[Read, Grep]");
    // A value over several lines is not a field the form can edit.
    expect(getField(doc, "description")).toBeUndefined();
  });

  test("setField troca, acrescenta e remove sem mexer no resto", () => {
    let doc = parseDocument(AGENT);
    doc = setField(doc, "description", "Outra");
    doc = setField(doc, "color", "blue");
    doc = setField(doc, "model", "");
    expect(serialize(doc)).toBe(
      "---\nname: revisor\ndescription: Outra\ntools: Read, Grep\ncolor: blue\n---\nVocê revisa código.\n",
    );
  });

  test("um valor que o YAML leria diferente ganha aspas; uma lista [..] não", () => {
    let doc = parseDocument(AGENT);
    doc = setField(doc, "description", "Use quando: houver diff");
    doc = setField(doc, "tools", "[Read, Edit]");
    expect(serialize(doc)).toContain('description: "Use quando: houver diff"');
    expect(serialize(doc)).toContain("tools: [Read, Edit]");
    expect(getField(parseDocument(serialize(doc)), "description")).toBe("Use quando: houver diff");
  });

  test("aspas simples saem sem aspas; campo novo num documento sem frontmatter cria o bloco", () => {
    expect(getField(parseDocument("---\nname: 'it''s'\n---\n"), "name")).toBe("it's");
    const doc = setField(parseDocument("corpo\n"), "name", "novo");
    expect(serialize(doc)).toBe("---\nname: novo\n---\ncorpo\n");
  });

  test("um campo que não existe e fica vazio não faz nada", () => {
    const doc = parseDocument(AGENT);
    expect(serialize(setField(doc, "color", ""))).toBe(AGENT);
  });

  test("aspas duplas que o YAML não lê ficam como estão, para o usuário ver", () => {
    const doc = parseDocument(String.raw`---
name: "a\qb"
---
`);
    expect(getField(doc, "name")).toBe(String.raw`"a\qb"`);
  });
});

