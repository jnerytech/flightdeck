import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";
import { displayPath } from "../../src/memory/domain/display-path.ts";
import { ProjectMemory } from "../../src/memory/memory.ts";
import { tempDir } from "../support/helpers.ts";

import { codeOf, setup, sha } from "../support/memory.ts";

describe("memoria: o orçamento de contexto", () => {
  /** A project with a file in every place the context loads from, and the user's own. */
  function seeded() {
    const ctx = setup();
    const managed = join(tempDir("fd-managed-"), "CLAUDE.md");
    const memory = new ProjectMemory({
      claudeDir: ctx.claudeDir,
      managedClaudeMd: managed,
      clock: () => Date.UTC(2026, 9, 31, 12),
    });
    const at = (root: string, path: string, text: string) => {
      mkdirSync(join(root, path, ".."), { recursive: true });
      writeFileSync(join(root, path), text);
    };
    at(managed, "../CLAUDE.md", "x".repeat(40));
    at(ctx.claudeDir, "CLAUDE.md", "u".repeat(100));
    at(ctx.claudeDir, "rules/pessoal.md", "r".repeat(20));
    at(
      ctx.claudeDir,
      "skills/s1/SKILL.md",
      `---\nname: s1\ndescription: faz tudo\n---\n${"corpo ".repeat(100)}`,
    );
    at(ctx.repo, "CLAUDE.md", "p".repeat(400));
    at(ctx.repo, ".claude/CLAUDE.md", "q".repeat(8));
    at(ctx.repo, "CLAUDE.local.md", "l".repeat(12));
    at(ctx.repo, "sub/CLAUDE.md", "s".repeat(60));
    at(ctx.repo, ".claude/rules/geral.md", "g".repeat(80));
    at(ctx.repo, ".claude/rules/web/api.md", `---\npaths:\n  - "src/**"\n---\n${"a".repeat(30)}`);
    at(
      ctx.repo,
      ".claude/skills/deploy/SKILL.md",
      "---\nname: deploy\ndescription: publica\n---\nlongo\n",
    );
    return { ...ctx, memory, managed };
  }
  const rel = (path: string, ctx: { claudeDir: string; repo: string; managed: string }) =>
    path
      .replace(displayPath(ctx.claudeDir, sep), "~")
      .replace(displayPath(ctx.repo, sep), ".")
      .replace(displayPath(ctx.managed, sep), "managed/CLAUDE.md");

  test("cada fonte entra com o tamanho, uma estimativa de tokens e se vem na partida ou só quando Claude lê", async () => {
    const ctx = seeded();
    const sources = (await ctx.memory.budget(ctx.repo)).sources.map((s) => [
      s.kind,
      rel(s.path, ctx),
      s.load,
      s.bytes,
      s.tokens,
    ]);
    const row = (kind: string, path: string, load: string, bytes: number) => [
      kind,
      path,
      load,
      bytes,
      Math.ceil(bytes / 4),
    ];
    const meta = (name: string, description: string) =>
      Buffer.byteLength(`${name}: ${description}`);
    expect(sources.sort((a, b) => String(a[1]).localeCompare(String(b[1])))).toEqual(
      [
        row("managed", "managed/CLAUDE.md", "start", 40),
        row("user", "~/CLAUDE.md", "start", 100),
        row("rules", "~/rules/pessoal.md", "start", 20),
        row("skills", "~/skills/s1/SKILL.md", "start", meta("s1", "faz tudo")),
        row("project", "./CLAUDE.md", "start", 400),
        row("project", "./.claude/CLAUDE.md", "start", 8),
        row("local", "./CLAUDE.local.md", "start", 12),
        row("project", "./sub/CLAUDE.md", "on-demand", 60),
        row("rules", "./.claude/rules/geral.md", "start", 80),
        row(
          "rules",
          "./.claude/rules/web/api.md",
          "on-demand",
          30 + Buffer.byteLength('---\npaths:\n  - "src/**"\n---\n'),
        ),
        row("skills", "./.claude/skills/deploy/SKILL.md", "start", meta("deploy", "publica")),
      ].sort((a, b) => String(a[1]).localeCompare(String(b[1]))),
    );
  });

  test("the budget is computed without blocking: it comes back as a promise", async () => {
    const ctx = seeded();
    const pending = ctx.memory.budget(ctx.repo);
    expect(pending).toBeInstanceOf(Promise);
    expect((await pending).sources.length).toBeGreaterThan(0);
  });

  test("o total da partida soma só o que entra na partida", async () => {
    const ctx = seeded();
    const budget = await ctx.memory.budget(ctx.repo);
    const start = budget.sources
      .filter((s) => s.load === "start")
      .reduce((n, s) => n + s.tokens, 0);
    expect(budget.startTokens).toBe(start);
    expect(start).toBeGreaterThan(0);
  });

  test("a memória que cabe entra inteira; os arquivos de tópico ficam para quando Claude os lê", async () => {
    const ctx = seeded();
    ctx.put(
      "MEMORY.md",
      "- [Papel](user_role.md) — quem é\n- [Testes](feedback_testes.md) — teste primeiro\n",
    );
    ctx.put("user_role.md", "r\n");
    ctx.put("feedback_testes.md", "t\n");
    const budget = await ctx.memory.budget(ctx.repo);
    expect(budget.memory).toEqual({
      limitLines: 200,
      limitBytes: 25600,
      indexLines: 2,
      indexBytes: Buffer.byteLength(readFileSync(join(ctx.dir, "MEMORY.md"), "utf8")),
      loadedLines: 2,
      loadedBytes: Buffer.byteLength(readFileSync(join(ctx.dir, "MEMORY.md"), "utf8")),
      cutBy: null,
      leftOutLines: [],
      leftOutFiles: [],
    });
    const memory = budget.sources
      .filter((s) => s.kind === "memory")
      .map((s) => [rel(s.path, ctx), s.load]);
    expect(memory.sort()).toEqual([
      [
        `${displayPath(ctx.dir, sep).replace(displayPath(ctx.claudeDir, sep), "~")}/MEMORY.md`,
        "start",
      ],
      [
        `${displayPath(ctx.dir, sep).replace(displayPath(ctx.claudeDir, sep), "~")}/feedback_testes.md`,
        "on-demand",
      ],
      [
        `${displayPath(ctx.dir, sep).replace(displayPath(ctx.claudeDir, sep), "~")}/user_role.md`,
        "on-demand",
      ],
    ]);
  });

  test("passando de 200 linhas, o resto fica de fora: as linhas e os arquivos que só elas citam", async () => {
    const ctx = seeded();
    const lines = Array.from({ length: 205 }, (_, i) => `- [Nota ${i + 1}](nota_${i + 1}.md) — n`);
    ctx.put("MEMORY.md", `${lines.join("\n")}\n`);
    for (const n of [1, 201, 205]) ctx.put(`nota_${n}.md`, "x\n");
    const { memory } = await ctx.memory.budget(ctx.repo);
    expect(memory.cutBy).toBe("lines");
    expect(memory.indexLines).toBe(205);
    expect(memory.loadedLines).toBe(200);
    expect(memory.leftOutLines).toEqual(lines.slice(200));
    expect(memory.leftOutFiles).toEqual(["nota_201.md", "nota_205.md"]);
  });

  test("passando de 25 KB com poucas linhas, quem corta é o tamanho, numa fronteira de linha", async () => {
    const ctx = seeded();
    const long = (n: number) => `- ${String(n).padStart(2, "0")} ${"x".repeat(1_020)}`;
    const lines = Array.from({ length: 30 }, (_, i) => long(i));
    ctx.put("MEMORY.md", `${lines.join("\n")}\n`);
    const { memory } = await ctx.memory.budget(ctx.repo);
    expect(memory.cutBy).toBe("bytes");
    expect(memory.loadedBytes).toBeLessThanOrEqual(25600);
    expect(memory.loadedLines).toBe(Math.floor(25600 / ((lines[0] as string).length + 1)));
    expect(memory.leftOutLines).toEqual(lines.slice(memory.loadedLines));
  });

  test("sem memória nem CLAUDE.md, o orçamento é vazio e não falha", async () => {
    const { memory, repo } = setup();
    const budget = await memory.budget(repo);
    expect(budget.sources.filter((s) => s.kind === "memory")).toEqual([]);
    expect(budget.memory.indexLines).toBe(0);
    expect(budget.memory.cutBy).toBeNull();
  });
});

describe("memoria: ramos do orçamento e dos nomes", () => {
  test("regras em subpastas entram, arquivos que não são .md e pastas fundas demais ficam de fora, e skills sem SKILL.md ou sem nome são ignoradas", async () => {
    const ctx = setup();
    const at = (root: string, path: string, text: string) => {
      mkdirSync(join(root, path, ".."), { recursive: true });
      writeFileSync(join(root, path), text);
    };
    at(ctx.repo, ".claude/rules/a/b.md", "b".repeat(8));
    at(ctx.repo, ".claude/rules/nota.txt", "x");
    at(ctx.repo, ".claude/rules/1/2/3/4/5/6/7/fundo.md", "x");
    at(ctx.repo, ".claude/skills/sem-arquivo/leia.txt", "x");
    at(ctx.repo, ".claude/skills/sem-nome/SKILL.md", "sem frontmatter\n");
    at(ctx.repo, ".claude/skills/solto.txt", "x");
    const paths = (await ctx.memory.budget(ctx.repo)).sources
      .filter((s) => s.kind === "rules" || s.kind === "skills")
      .map((s) => s.path.replace(displayPath(ctx.repo, sep), "."));
    expect(paths).toEqual(["./.claude/rules/a/b.md"]);
  });

  test("um arquivo de memória que é um link não é lido nem gravado", async () => {
    const { memory, repo, dir, put } = setup();
    put("MEMORY.md", "x\n");
    const outside = join(tempDir("fd-outside-"), "alvo.md");
    writeFileSync(outside, "fora\n");
    symlinkSync(outside, join(dir, "link.md"));
    expect(await codeOf(async () => await memory.read(repo, "link.md"))).toBe("bad_request");
    expect(
      await codeOf(
        async () =>
          await memory.write(repo, {
            name: "link.md",
            content: "x",
            expectedHash: sha("fora\n"),
            confirm: true,
          }),
      ),
    ).toBe("bad_request");
    expect(readFileSync(outside, "utf8")).toBe("fora\n");
  });
});
