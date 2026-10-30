import { describe, expect, test } from "bun:test";
import { GlobalPersonas } from "../src/lib/global-personas.ts";

function setup() {
  const items = new Map<string, string>();
  const platform = {
    storage: {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => {
        items.set(key, value);
      },
    },
  };
  return { platform, personas: new GlobalPersonas(platform) };
}

const codeOf = (fn: () => unknown) => {
  try {
    fn();
    return "ok";
  } catch (error) {
    return (error as { code?: string }).code ?? "no code";
  }
};

const qa = {
  id: "meu-qa",
  name: "Meu QA",
  description: "Testes primeiro",
  model: "claude-sonnet-5-5",
  effort: "high" as const,
  tools: ["Read", "Grep"],
  permissionMode: "plan" as const,
  body: "Escreva o teste antes do código.",
};

describe("personas-ui: the app's global personas", () => {
  test("a persona is kept in normal form, as the app's, and survives a new instance", () => {
    const { personas, platform } = setup();
    const saved = personas.save(qa);
    expect(saved).toEqual({
      ...qa,
      icon: null,
      scope: "app",
      hash: null,
      trusted: true,
      modified: false,
    });
    expect(new GlobalPersonas(platform).list().map((p) => p.id)).toEqual(["meu-qa"]);
  });

  test("the daemon's model judges it: a secret is persona_secret, a body over 8 KB or a bad id is bad_request", () => {
    const { personas } = setup();
    expect(
      codeOf(() => personas.save({ ...qa, body: "use ghp_abcdefghijklmnopqrstuvwxyz0123456789" })),
    ).toBe("persona_secret");
    expect(codeOf(() => personas.save({ ...qa, body: "x".repeat(8193) }))).toBe("bad_request");
    expect(codeOf(() => personas.save({ ...qa, id: "Com Espaço" }))).toBe("bad_request");
    expect(personas.list()).toEqual([]);
  });

  test("saving the same id replaces it; the list is by name; remove takes it out", () => {
    const { personas } = setup();
    personas.save(qa);
    personas.save({ ...qa, id: "arq", name: "Arquiteto meu", body: "Proponha antes." });
    personas.save({ ...qa, name: "QA de novo" });
    expect(personas.list().map((p) => p.name)).toEqual(["Arquiteto meu", "QA de novo"]);
    personas.remove("arq");
    expect(personas.list().map((p) => p.id)).toEqual(["meu-qa"]);
  });

  test("a session asks for a global persona by its whole definition, in the app's language", () => {
    const { personas } = setup();
    personas.save(qa);
    expect(personas.ref("meu-qa", "en")).toEqual({
      definition: {
        id: "meu-qa",
        name: "Meu QA",
        description: "Testes primeiro",
        model: "claude-sonnet-5-5",
        effort: "high",
        tools: ["Read", "Grep"],
        permissionMode: "plan",
        body: "Escreva o teste antes do código.",
      },
      language: "en",
    });
    expect(personas.ref("nao-existe", "en")).toBeNull();
  });
});
