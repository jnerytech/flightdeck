import { describe, expect, test } from "bun:test";
import { scopeHint, scopeName } from "../../src/features/plugins/scope.ts";
import { translator } from "../../src/i18n/index.ts";

const en = translator("en");
const ptBR = translator("pt-BR");

describe("plugins: the scope of an installed plugin", () => {
  test("each scope has a name and a meaning in English", () => {
    expect(["user", "project", "local"].map((s) => scopeName(en, s))).toEqual([
      "User",
      "Project",
      "Local",
    ]);
    expect(scopeHint(en, "user")).toBe(
      "Installed for you: it works in every project on this machine.",
    );
    expect(scopeHint(en, "project")).toContain("shared with its team");
    expect(scopeHint(en, "local")).toContain("not shared");
  });

  test("each scope has a name and a meaning in Portuguese", () => {
    expect(["user", "project", "local"].map((s) => scopeName(ptBR, s))).toEqual([
      "Usuário",
      "Projeto",
      "Local",
    ]);
    expect(scopeHint(ptBR, "user")).toContain("todos os projetos");
    expect(scopeHint(ptBR, "project")).toContain("compartilhado com a equipe");
    expect(scopeHint(ptBR, "local")).toContain("não é compartilhado");
  });

  test("a scope the app does not know shows as it is, with no meaning", () => {
    expect(scopeName(ptBR, "managed")).toBe("managed");
    expect(scopeHint(ptBR, "managed")).toBeUndefined();
    expect(scopeName(en, "toString")).toBe("toString");
    expect(scopeHint(en, "toString")).toBeUndefined();
  });
});
