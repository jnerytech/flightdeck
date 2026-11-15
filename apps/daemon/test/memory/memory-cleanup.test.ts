import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, utimesSync } from "node:fs";
import { join } from "node:path";

import { setup, sha } from "../support/memory.ts";

describe("memoria: limpeza sugerida", () => {
  const snapshot = (dir: string) =>
    readdirSync(dir)
      .sort()
      .map((n) => [n, sha(readFileSync(join(dir, n), "utf8"))]);
  const topic = (type: string, description: string, body = "corpo\n") =>
    `---\nname: n\ndescription: ${description}\ntype: ${type}\n---\n${body}`;

  test("the suggestions come back as a promise, so the folder is read without blocking", async () => {
    const { memory, repo, put } = setup();
    put("a.md", topic("user", "papel do usuário"));
    const pending = memory.suggest(repo);
    expect(pending).toBeInstanceOf(Promise);
    expect((await pending).length).toBeGreaterThan(0);
  });

  test("memória em ordem não rende sugestão", async () => {
    const { memory, repo, put } = setup();
    put("MEMORY.md", "- [A](a.md) — a\n");
    put("a.md", topic("user", "papel do usuário"));
    expect(await memory.suggest(repo)).toEqual([]);
  });

  test("dois arquivos com o mesmo conteúdo são duplicados", async () => {
    const { memory, repo, put } = setup();
    put("MEMORY.md", "- [A](a.md)\n- [B](b.md)\n- [C](c.md)\n");
    put("a.md", topic("user", "igual"));
    put("b.md", topic("user", "igual"));
    put("c.md", topic("user", "outro"));
    expect(await memory.suggest(repo)).toEqual([{ kind: "duplicate", files: ["a.md", "b.md"] }]);
  });

  test("uma linha do índice para um arquivo que não existe, e um arquivo que o índice não cita", async () => {
    const { memory, repo, put } = setup();
    put("MEMORY.md", "- [Some](sumiu.md) — era um arquivo\n- [A](a.md)\n");
    put("a.md", topic("user", "a"));
    put("solto.md", topic("user", "solto"));
    expect(await memory.suggest(repo)).toEqual([
      { kind: "broken-link", files: ["sumiu.md"], detail: "- [Some](sumiu.md) — era um arquivo" },
      { kind: "orphan", files: ["solto.md"] },
    ]);
  });

  test("arquivo de tópico sem mudança há mais de 90 dias é antigo; o índice nunca é", async () => {
    const { memory, repo, dir, put } = setup();
    put("MEMORY.md", "- [Velha](velha.md)\n- [Nova](nova.md)\n");
    put("velha.md", topic("project", "velha"));
    put("nova.md", topic("project", "nova"));
    const old = new Date(Date.UTC(2026, 9, 31, 12) - 91 * 86_400_000);
    utimesSync(join(dir, "velha.md"), old, old);
    utimesSync(join(dir, "MEMORY.md"), old, old);
    expect(await memory.suggest(repo)).toEqual([{ kind: "stale", files: ["velha.md"] }]);
  });

  test("duas memórias do mesmo tipo que dizem o contrário são apontadas como contradição", async () => {
    const { memory, repo, put } = setup();
    put("MEMORY.md", "- [A](a.md)\n- [B](b.md)\n- [C](c.md)\n");
    put("a.md", topic("feedback", "always run the tests before commit"));
    put("b.md", topic("feedback", "never run the tests before commit"));
    put("c.md", topic("feedback", "keep answers short"));
    expect(await memory.suggest(repo)).toEqual([
      { kind: "contradiction", files: ["a.md", "b.md"] },
    ]);
  });

  test("tipos diferentes não se contradizem, e coisas sem relação não entram", async () => {
    const { memory, repo, put } = setup();
    put("MEMORY.md", "- [A](a.md)\n- [B](b.md)\n");
    put("a.md", topic("feedback", "always run the tests before commit"));
    put("b.md", topic("reference", "never run the tests before commit"));
    expect(await memory.suggest(repo)).toEqual([]);
  });

  test("sugerir não edita nada: a pasta fica byte a byte igual", async () => {
    const { memory, repo, dir, put, decisions } = setup();
    put("MEMORY.md", "- [Some](sumiu.md)\n");
    put("a.md", topic("user", "igual"));
    put("b.md", topic("user", "igual"));
    const before = snapshot(dir);
    expect((await memory.suggest(repo)).length).toBeGreaterThan(0);
    expect(snapshot(dir)).toEqual(before);
    expect(decisions).toEqual([]);
  });

  test("sem pasta de memória não há o que sugerir", async () => {
    const { memory, repo } = setup();
    expect(await memory.suggest(repo)).toEqual([]);
  });
});
