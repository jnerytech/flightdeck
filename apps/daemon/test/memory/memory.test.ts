import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { ProjectMemory } from "../../src/memory/memory.ts";
import { git } from "../support/board-helpers.ts";
import { tempDir } from "../support/helpers.ts";

import { codeOf, setup, sha, slugOf } from "../support/memory.ts";

describe("memoria: onde fica", () => {
  test("a pasta é projects/<caminho com - no lugar do que não é letra ou número>/memory, e não existir não é erro", async () => {
    const { memory, repo, dir } = setup();
    expect(await memory.dir(repo)).toBe(dir);
    expect(await memory.list(repo)).toEqual({ dir, exists: false, files: [] });
  });

  test("as worktrees e as subpastas do mesmo repositório dividem a mesma pasta", async () => {
    const { memory, repo, dir } = setup();
    const worktree = join(tempDir("fd-wt-"), "feature");
    git(repo, "worktree", "add", "-q", "-b", "feature", worktree);
    mkdirSync(join(repo, "sub"));
    expect(await memory.dir(worktree)).toBe(dir);
    expect(await memory.dir(join(repo, "sub"))).toBe(dir);
  });

  test("fora de um repositório git vale a própria pasta do projeto", async () => {
    const { memory, claudeDir } = setup();
    const plain = tempDir("fd-plain-");
    expect(await memory.dir(plain)).toBe(join(claudeDir, "projects", slugOf(plain), "memory"));
  });
});

describe("memoria: ler", () => {
  test("lista os arquivos em ordem, com hash, bytes, linhas, tipo, descrição e se o índice os cita", async () => {
    const { memory, repo, dir, put } = setup();
    put("MEMORY.md", "- [Papel](user_role.md) — quem é o usuário\n");
    put(
      "user_role.md",
      "---\nname: papel\ndescription: quem é o usuário\ntype: user\n---\nÉ engenheiro.\n",
    );
    put("solta.md", "sem frontmatter\nduas linhas\n");
    const listing = await memory.list(repo);
    expect(listing.exists).toBe(true);
    expect(listing.dir).toBe(dir);
    expect(listing.files.map((f) => [f.name, f.inIndex])).toEqual([
      ["MEMORY.md", true],
      ["solta.md", false],
      ["user_role.md", true],
    ]);
    const role = listing.files.find((f) => f.name === "user_role.md");
    const text = readFileSync(join(dir, "user_role.md"), "utf8");
    expect(role).toEqual({
      name: "user_role.md",
      hash: sha(text),
      bytes: Buffer.byteLength(text),
      lines: 6,
      type: "user",
      description: "quem é o usuário",
      inIndex: true,
    });
  });

  test("read devolve o conteúdo com o hash; um nome que não existe é not_found", async () => {
    const { memory, repo, put } = setup();
    put("MEMORY.md", "- um\n");
    const opened = await memory.read(repo, "MEMORY.md");
    expect(opened.content).toBe("- um\n");
    expect(opened.hash).toBe(sha("- um\n"));
    expect(await codeOf(async () => await memory.read(repo, "nada.md"))).toBe("not_found");
  });

  test("só nomes simples de arquivo .md valem: nada de subpasta, .. ou outra extensão", async () => {
    const { memory, repo, put } = setup();
    put("MEMORY.md", "x\n");
    for (const name of [
      "../MEMORY.md",
      "a/b.md",
      "..\\x.md",
      "",
      "x.txt",
      ".md",
      "/etc/passwd.md",
    ]) {
      expect([name, await codeOf(async () => await memory.read(repo, name))]).toEqual([
        name,
        "bad_request",
      ]);
    }
  });
});

describe("memoria: editar", () => {
  const input = (over: Record<string, unknown> = {}) => ({
    name: "feedback_testes.md",
    content: "---\nname: testes\ndescription: d\ntype: feedback\n---\nTeste primeiro.\n",
    expectedHash: null as string | null,
    confirm: true,
    ...over,
  });

  test("grava com confirmação, cria a pasta se faltar e devolve o hash do que gravou", async () => {
    const { memory, repo, dir } = setup();
    expect(existsSync(dir)).toBe(false);
    const written = await memory.write(repo, input());
    expect(written.hash).toBe(sha(input().content));
    expect(readFileSync(join(dir, "feedback_testes.md"), "utf8")).toBe(input().content);
  });

  test("sem confirm não grava; criar um que já existe e editar um que mudou são recusados", async () => {
    const { memory, repo, dir, put } = setup();
    expect(await codeOf(async () => await memory.write(repo, input({ confirm: false })))).toBe(
      "invalid_state",
    );
    expect(existsSync(dir)).toBe(false);
    put("a.md", "um\n");
    expect(await codeOf(async () => await memory.write(repo, input({ name: "a.md" })))).toBe(
      "invalid_state",
    );
    expect(
      await codeOf(
        async () => await memory.write(repo, input({ name: "a.md", expectedHash: sha("outro\n") })),
      ),
    ).toBe("invalid_state");
    expect(readFileSync(join(dir, "a.md"), "utf8")).toBe("um\n");
    await memory.write(repo, input({ name: "a.md", content: "dois\n", expectedHash: sha("um\n") }));
    expect(readFileSync(join(dir, "a.md"), "utf8")).toBe("dois\n");
  });

  test("escreve só dentro da pasta de memória: nome com .. ou barra é recusado e nada sai de lá", async () => {
    const { memory, repo, claudeDir } = setup();
    for (const name of ["../../evil.md", "../evil.md", "sub/evil.md", "..\\evil.md"]) {
      expect([name, await codeOf(async () => await memory.write(repo, input({ name })))]).toEqual([
        name,
        "bad_request",
      ]);
    }
    const stray = readdirSync(claudeDir, { recursive: true }).filter((p) =>
      String(p).endsWith("evil.md"),
    );
    expect(stray).toEqual([]);
  });

  test("uma pasta de memória que é um link para fora não deixa gravar", async () => {
    const { memory, repo, dir } = setup();
    const outside = tempDir("fd-outside-");
    mkdirSync(join(dir, ".."), { recursive: true });
    symlinkSync(outside, dir);
    expect(await codeOf(async () => await memory.write(repo, input()))).toBe("bad_request");
    expect(readdirSync(outside)).toEqual([]);
  });

  test("apagar pede confirm e o hash; registra a decisão sem o conteúdo", async () => {
    const { memory, repo, dir, put, decisions } = setup();
    put("velha.md", "velha\n");
    expect(
      await codeOf(
        async () =>
          await memory.remove(repo, {
            name: "velha.md",
            expectedHash: sha("velha\n"),
            confirm: false,
          }),
      ),
    ).toBe("invalid_state");
    expect(
      await codeOf(
        async () =>
          await memory.remove(repo, { name: "velha.md", expectedHash: sha("x"), confirm: true }),
      ),
    ).toBe("invalid_state");
    expect(existsSync(join(dir, "velha.md"))).toBe(true);
    await memory.remove(repo, { name: "velha.md", expectedHash: sha("velha\n"), confirm: true });
    expect(existsSync(join(dir, "velha.md"))).toBe(false);
    expect(decisions).toEqual([
      {
        action: "delete",
        name: "velha.md",
        before: sha("velha\n"),
        after: null,
        at: "2026-10-31T12:00:00.000Z",
      },
    ]);
    expect(
      await codeOf(
        async () =>
          await memory.remove(repo, {
            name: "velha.md",
            expectedHash: sha("velha\n"),
            confirm: true,
          }),
      ),
    ).toBe("not_found");
  });

  test("cada gravação registra a decisão: ação, nome, hash antes e depois, hora, e nunca o texto", async () => {
    const { memory, repo, decisions } = setup();
    await memory.write(repo, input());
    await memory.write(repo, input({ content: "novo\n", expectedHash: sha(input().content) }));
    expect(decisions.map((d) => [d.action, d.name, d.before, d.after])).toEqual([
      ["write", "feedback_testes.md", null, sha(input().content)],
      ["write", "feedback_testes.md", sha(input().content), sha("novo\n")],
    ]);
    expect(JSON.stringify(decisions)).not.toContain("Teste primeiro");
  });
});

describe("memoria: a lookup that fails", () => {
  test("a project memory lookup that fails is dropped, and a second request made meanwhile fails too", async () => {
    const mem = new ProjectMemory({ claudeDir: tempDir("fd-memory-") });
    const missing = join(tempDir(), "no", "such", "project");
    const results = await Promise.allSettled([mem.dir(missing), mem.dir(missing)]);
    expect(results.map((r) => r.status)).toEqual(["rejected", "rejected"]);
  });
});
