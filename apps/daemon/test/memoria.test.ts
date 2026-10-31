import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { type MemoryDecision, ProjectMemory } from "../src/memory/memory.ts";
import { git, gitRepo } from "./board-helpers.ts";
import { tempDir } from "./helpers.ts";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const codeOf = (fn: () => unknown): string => {
  try {
    fn();
    return "ok";
  } catch (error) {
    return (error as { code?: string }).code ?? "sem código";
  }
};
const slugOf = (path: string) => path.replace(/[^A-Za-z0-9]/g, "-");

function setup() {
  const claudeDir = tempDir("fd-claude-");
  const { repo } = gitRepo();
  const decisions: MemoryDecision[] = [];
  const memory = new ProjectMemory({
    claudeDir,
    clock: () => Date.UTC(2026, 9, 31, 12),
    record: (d) => decisions.push(d),
  });
  const dir = join(claudeDir, "projects", slugOf(repo), "memory");
  const put = (name: string, text: string) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name), text);
  };
  return { claudeDir, repo, memory, decisions, dir, put };
}

describe("memoria: onde fica", () => {
  test("a pasta é projects/<caminho com - no lugar do que não é letra ou número>/memory, e não existir não é erro", () => {
    const { memory, repo, dir } = setup();
    expect(memory.dir(repo)).toBe(dir);
    expect(memory.list(repo)).toEqual({ dir, exists: false, files: [] });
  });

  test("as worktrees e as subpastas do mesmo repositório dividem a mesma pasta", () => {
    const { memory, repo, dir } = setup();
    const worktree = join(tempDir("fd-wt-"), "feature");
    git(repo, "worktree", "add", "-q", "-b", "feature", worktree);
    mkdirSync(join(repo, "sub"));
    expect(memory.dir(worktree)).toBe(dir);
    expect(memory.dir(join(repo, "sub"))).toBe(dir);
  });

  test("fora de um repositório git vale a própria pasta do projeto", () => {
    const { memory, claudeDir } = setup();
    const plain = tempDir("fd-plain-");
    expect(memory.dir(plain)).toBe(join(claudeDir, "projects", slugOf(plain), "memory"));
  });
});

describe("memoria: ler", () => {
  test("lista os arquivos em ordem, com hash, bytes, linhas, tipo, descrição e se o índice os cita", () => {
    const { memory, repo, dir, put } = setup();
    put("MEMORY.md", "- [Papel](user_role.md) — quem é o usuário\n");
    put(
      "user_role.md",
      "---\nname: papel\ndescription: quem é o usuário\ntype: user\n---\nÉ engenheiro.\n",
    );
    put("solta.md", "sem frontmatter\nduas linhas\n");
    const listing = memory.list(repo);
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

  test("read devolve o conteúdo com o hash; um nome que não existe é not_found", () => {
    const { memory, repo, put } = setup();
    put("MEMORY.md", "- um\n");
    const opened = memory.read(repo, "MEMORY.md");
    expect(opened.content).toBe("- um\n");
    expect(opened.hash).toBe(sha("- um\n"));
    expect(codeOf(() => memory.read(repo, "nada.md"))).toBe("not_found");
  });

  test("só nomes simples de arquivo .md valem: nada de subpasta, .. ou outra extensão", () => {
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
      expect([name, codeOf(() => memory.read(repo, name))]).toEqual([name, "bad_request"]);
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

  test("grava com confirmação, cria a pasta se faltar e devolve o hash do que gravou", () => {
    const { memory, repo, dir } = setup();
    expect(existsSync(dir)).toBe(false);
    const written = memory.write(repo, input());
    expect(written.hash).toBe(sha(input().content));
    expect(readFileSync(join(dir, "feedback_testes.md"), "utf8")).toBe(input().content);
  });

  test("sem confirm não grava; criar um que já existe e editar um que mudou são recusados", () => {
    const { memory, repo, dir, put } = setup();
    expect(codeOf(() => memory.write(repo, input({ confirm: false })))).toBe("invalid_state");
    expect(existsSync(dir)).toBe(false);
    put("a.md", "um\n");
    expect(codeOf(() => memory.write(repo, input({ name: "a.md" })))).toBe("invalid_state");
    expect(
      codeOf(() => memory.write(repo, input({ name: "a.md", expectedHash: sha("outro\n") }))),
    ).toBe("invalid_state");
    expect(readFileSync(join(dir, "a.md"), "utf8")).toBe("um\n");
    memory.write(repo, input({ name: "a.md", content: "dois\n", expectedHash: sha("um\n") }));
    expect(readFileSync(join(dir, "a.md"), "utf8")).toBe("dois\n");
  });

  test("escreve só dentro da pasta de memória: nome com .. ou barra é recusado e nada sai de lá", () => {
    const { memory, repo, claudeDir } = setup();
    for (const name of ["../../evil.md", "../evil.md", "sub/evil.md", "..\\evil.md"]) {
      expect([name, codeOf(() => memory.write(repo, input({ name })))]).toEqual([
        name,
        "bad_request",
      ]);
    }
    const stray = readdirSync(claudeDir, { recursive: true }).filter((p) =>
      String(p).endsWith("evil.md"),
    );
    expect(stray).toEqual([]);
  });

  test("uma pasta de memória que é um link para fora não deixa gravar", () => {
    const { memory, repo, dir } = setup();
    const outside = tempDir("fd-outside-");
    mkdirSync(join(dir, ".."), { recursive: true });
    symlinkSync(outside, dir);
    expect(codeOf(() => memory.write(repo, input()))).toBe("bad_request");
    expect(readdirSync(outside)).toEqual([]);
  });

  test("apagar pede confirm e o hash; registra a decisão sem o conteúdo", () => {
    const { memory, repo, dir, put, decisions } = setup();
    put("velha.md", "velha\n");
    expect(
      codeOf(() =>
        memory.remove(repo, { name: "velha.md", expectedHash: sha("velha\n"), confirm: false }),
      ),
    ).toBe("invalid_state");
    expect(
      codeOf(() =>
        memory.remove(repo, { name: "velha.md", expectedHash: sha("x"), confirm: true }),
      ),
    ).toBe("invalid_state");
    expect(existsSync(join(dir, "velha.md"))).toBe(true);
    memory.remove(repo, { name: "velha.md", expectedHash: sha("velha\n"), confirm: true });
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
      codeOf(() =>
        memory.remove(repo, { name: "velha.md", expectedHash: sha("velha\n"), confirm: true }),
      ),
    ).toBe("not_found");
  });

  test("cada gravação registra a decisão: ação, nome, hash antes e depois, hora, e nunca o texto", () => {
    const { memory, repo, decisions } = setup();
    memory.write(repo, input());
    memory.write(repo, input({ content: "novo\n", expectedHash: sha(input().content) }));
    expect(decisions.map((d) => [d.action, d.name, d.before, d.after])).toEqual([
      ["write", "feedback_testes.md", null, sha(input().content)],
      ["write", "feedback_testes.md", sha(input().content), sha("novo\n")],
    ]);
    expect(JSON.stringify(decisions)).not.toContain("Teste primeiro");
  });
});
