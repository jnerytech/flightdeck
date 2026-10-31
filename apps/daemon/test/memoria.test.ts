import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { startDaemon } from "../src/main.ts";
import { decisionLog, type MemoryDecision, ProjectMemory } from "../src/memory/memory.ts";
import { startServer } from "../src/server.ts";
import { git, gitRepo, newBoard } from "./board-helpers.ts";
import { tempDir } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

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
      "---\nname: s1\ndescription: faz tudo\n---\n" + "corpo ".repeat(100),
    );
    at(ctx.repo, "CLAUDE.md", "p".repeat(400));
    at(ctx.repo, ".claude/CLAUDE.md", "q".repeat(8));
    at(ctx.repo, "CLAUDE.local.md", "l".repeat(12));
    at(ctx.repo, "sub/CLAUDE.md", "s".repeat(60));
    at(ctx.repo, ".claude/rules/geral.md", "g".repeat(80));
    at(ctx.repo, ".claude/rules/web/api.md", '---\npaths:\n  - "src/**"\n---\n' + "a".repeat(30));
    at(
      ctx.repo,
      ".claude/skills/deploy/SKILL.md",
      "---\nname: deploy\ndescription: publica\n---\nlongo\n",
    );
    return { ...ctx, memory, managed };
  }
  const rel = (path: string, ctx: { claudeDir: string; repo: string; managed: string }) =>
    path
      .replace(ctx.claudeDir, "~")
      .replace(ctx.repo, ".")
      .replace(ctx.managed, "managed/CLAUDE.md");

  test("cada fonte entra com o tamanho, uma estimativa de tokens e se vem na partida ou só quando Claude lê", () => {
    const ctx = seeded();
    const sources = ctx.memory
      .budget(ctx.repo)
      .sources.map((s) => [s.kind, rel(s.path, ctx), s.load, s.bytes, s.tokens]);
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

  test("o total da partida soma só o que entra na partida", () => {
    const ctx = seeded();
    const budget = ctx.memory.budget(ctx.repo);
    const start = budget.sources
      .filter((s) => s.load === "start")
      .reduce((n, s) => n + s.tokens, 0);
    expect(budget.startTokens).toBe(start);
    expect(start).toBeGreaterThan(0);
  });

  test("a memória que cabe entra inteira; os arquivos de tópico ficam para quando Claude os lê", () => {
    const ctx = seeded();
    ctx.put(
      "MEMORY.md",
      "- [Papel](user_role.md) — quem é\n- [Testes](feedback_testes.md) — teste primeiro\n",
    );
    ctx.put("user_role.md", "r\n");
    ctx.put("feedback_testes.md", "t\n");
    const budget = ctx.memory.budget(ctx.repo);
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
      [`${ctx.dir.replace(ctx.claudeDir, "~")}/MEMORY.md`, "start"],
      [`${ctx.dir.replace(ctx.claudeDir, "~")}/feedback_testes.md`, "on-demand"],
      [`${ctx.dir.replace(ctx.claudeDir, "~")}/user_role.md`, "on-demand"],
    ]);
  });

  test("passando de 200 linhas, o resto fica de fora: as linhas e os arquivos que só elas citam", () => {
    const ctx = seeded();
    const lines = Array.from({ length: 205 }, (_, i) => `- [Nota ${i + 1}](nota_${i + 1}.md) — n`);
    ctx.put("MEMORY.md", `${lines.join("\n")}\n`);
    for (const n of [1, 201, 205]) ctx.put(`nota_${n}.md`, "x\n");
    const { memory } = ctx.memory.budget(ctx.repo);
    expect(memory.cutBy).toBe("lines");
    expect(memory.indexLines).toBe(205);
    expect(memory.loadedLines).toBe(200);
    expect(memory.leftOutLines).toEqual(lines.slice(200));
    expect(memory.leftOutFiles).toEqual(["nota_201.md", "nota_205.md"]);
  });

  test("passando de 25 KB com poucas linhas, quem corta é o tamanho, numa fronteira de linha", () => {
    const ctx = seeded();
    const long = (n: number) => `- ${String(n).padStart(2, "0")} ${"x".repeat(1_020)}`;
    const lines = Array.from({ length: 30 }, (_, i) => long(i));
    ctx.put("MEMORY.md", `${lines.join("\n")}\n`);
    const { memory } = ctx.memory.budget(ctx.repo);
    expect(memory.cutBy).toBe("bytes");
    expect(memory.loadedBytes).toBeLessThanOrEqual(25600);
    expect(memory.loadedLines).toBe(Math.floor(25600 / ((lines[0] as string).length + 1)));
    expect(memory.leftOutLines).toEqual(lines.slice(memory.loadedLines));
  });

  test("sem memória nem CLAUDE.md, o orçamento é vazio e não falha", () => {
    const { memory, repo } = setup();
    const budget = memory.budget(repo);
    expect(budget.sources.filter((s) => s.kind === "memory")).toEqual([]);
    expect(budget.memory.indexLines).toBe(0);
    expect(budget.memory.cutBy).toBeNull();
  });
});

describe("memoria: limpeza sugerida", () => {
  const snapshot = (dir: string) =>
    readdirSync(dir)
      .sort()
      .map((n) => [n, sha(readFileSync(join(dir, n), "utf8"))]);
  const topic = (type: string, description: string, body = "corpo\n") =>
    `---\nname: n\ndescription: ${description}\ntype: ${type}\n---\n${body}`;

  test("memória em ordem não rende sugestão", () => {
    const { memory, repo, put } = setup();
    put("MEMORY.md", "- [A](a.md) — a\n");
    put("a.md", topic("user", "papel do usuário"));
    expect(memory.suggest(repo)).toEqual([]);
  });

  test("dois arquivos com o mesmo conteúdo são duplicados", () => {
    const { memory, repo, put } = setup();
    put("MEMORY.md", "- [A](a.md)\n- [B](b.md)\n- [C](c.md)\n");
    put("a.md", topic("user", "igual"));
    put("b.md", topic("user", "igual"));
    put("c.md", topic("user", "outro"));
    expect(memory.suggest(repo)).toEqual([{ kind: "duplicate", files: ["a.md", "b.md"] }]);
  });

  test("uma linha do índice para um arquivo que não existe, e um arquivo que o índice não cita", () => {
    const { memory, repo, put } = setup();
    put("MEMORY.md", "- [Some](sumiu.md) — era um arquivo\n- [A](a.md)\n");
    put("a.md", topic("user", "a"));
    put("solto.md", topic("user", "solto"));
    expect(memory.suggest(repo)).toEqual([
      { kind: "broken-link", files: ["sumiu.md"], detail: "- [Some](sumiu.md) — era um arquivo" },
      { kind: "orphan", files: ["solto.md"] },
    ]);
  });

  test("arquivo de tópico sem mudança há mais de 90 dias é antigo; o índice nunca é", () => {
    const { memory, repo, dir, put } = setup();
    put("MEMORY.md", "- [Velha](velha.md)\n- [Nova](nova.md)\n");
    put("velha.md", topic("project", "velha"));
    put("nova.md", topic("project", "nova"));
    const old = new Date(Date.UTC(2026, 9, 31, 12) - 91 * 86_400_000);
    utimesSync(join(dir, "velha.md"), old, old);
    utimesSync(join(dir, "MEMORY.md"), old, old);
    expect(memory.suggest(repo)).toEqual([{ kind: "stale", files: ["velha.md"] }]);
  });

  test("duas memórias do mesmo tipo que dizem o contrário são apontadas como contradição", () => {
    const { memory, repo, put } = setup();
    put("MEMORY.md", "- [A](a.md)\n- [B](b.md)\n- [C](c.md)\n");
    put("a.md", topic("feedback", "always run the tests before commit"));
    put("b.md", topic("feedback", "never run the tests before commit"));
    put("c.md", topic("feedback", "keep answers short"));
    expect(memory.suggest(repo)).toEqual([{ kind: "contradiction", files: ["a.md", "b.md"] }]);
  });

  test("tipos diferentes não se contradizem, e coisas sem relação não entram", () => {
    const { memory, repo, put } = setup();
    put("MEMORY.md", "- [A](a.md)\n- [B](b.md)\n");
    put("a.md", topic("feedback", "always run the tests before commit"));
    put("b.md", topic("reference", "never run the tests before commit"));
    expect(memory.suggest(repo)).toEqual([]);
  });

  test("sugerir não edita nada: a pasta fica byte a byte igual", () => {
    const { memory, repo, dir, put, decisions } = setup();
    put("MEMORY.md", "- [Some](sumiu.md)\n");
    put("a.md", topic("user", "igual"));
    put("b.md", topic("user", "igual"));
    const before = snapshot(dir);
    expect(memory.suggest(repo).length).toBeGreaterThan(0);
    expect(snapshot(dir)).toEqual(before);
    expect(decisions).toEqual([]);
  });

  test("sem pasta de memória não há o que sugerir", () => {
    const { memory, repo } = setup();
    expect(memory.suggest(repo)).toEqual([]);
  });
});

describe("memoria: protocolo", () => {
  const TOKEN = "memoria-token-0123456789abcdef";
  const cleanups: Array<() => unknown> = [];
  afterEach(async () => {
    for (const fn of cleanups.splice(0).reverse()) await fn();
  });

  async function served(withMemory = true) {
    const claudeDir = tempDir("fd-claude-");
    const { board, manager, repo } = newBoard();
    const memory = new ProjectMemory({ claudeDir, clock: () => Date.UTC(2026, 9, 31, 12) });
    const dir = join(claudeDir, "projects", slugOf(repo), "memory");
    const put = (name: string, text: string) => {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, name), text);
    };
    const { id: projectId } = await board.addProject({ path: repo });
    const server = startServer({
      manager,
      board,
      ...(withMemory ? { memory } : {}),
      features: undefined,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [],
    });
    cleanups.push(() => server.stop());
    const client = new FrameClient(server.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    return { client, projectId, dir, put };
  }

  test("host.info anuncia memory só quando a memória está ligada", async () => {
    const on = await served();
    expect((await on.client.data<{ features: string[] }>("host.info", {}))?.features).toContain(
      "memory",
    );
    const off = await served(false);
    expect(
      (await off.client.data<{ features: string[] }>("host.info", {}))?.features,
    ).not.toContain("memory");
    expect(await off.client.request("memory.list", { projectId: off.projectId })).toMatchObject({
      ok: false,
      error: { code: "invalid_state" },
    });
  });

  test("memory.list, read, write e delete por projeto, com o hash e a confirmação", async () => {
    const { client, projectId, dir, put } = await served();
    put("MEMORY.md", "- [A](a.md)\n");
    put("a.md", "a\n");
    const listed = await client.data<{ exists: boolean; files: Array<{ name: string }> }>(
      "memory.list",
      { projectId },
    );
    expect(listed?.exists).toBe(true);
    expect(listed?.files.map((f) => f.name)).toEqual(["MEMORY.md", "a.md"]);
    const read = await client.data<{ content: string; hash: string }>("memory.read", {
      projectId,
      name: "a.md",
    });
    expect(read).toMatchObject({ content: "a\n", hash: sha("a\n") });
    const edit = { projectId, name: "a.md", content: "b\n", expectedHash: sha("a\n") };
    expect(await client.request("memory.write", edit)).toMatchObject({
      ok: false,
      error: { code: "invalid_state" },
    });
    expect(readFileSync(join(dir, "a.md"), "utf8")).toBe("a\n");
    expect(await client.data("memory.write", { ...edit, confirm: true })).toEqual({
      hash: sha("b\n"),
    });
    expect(
      await client.request("memory.delete", { projectId, name: "a.md", expectedHash: sha("b\n") }),
    ).toMatchObject({
      ok: false,
      error: { code: "invalid_state" },
    });
    expect(
      await client.data("memory.delete", {
        projectId,
        name: "a.md",
        expectedHash: sha("b\n"),
        confirm: true,
      }),
    ).toEqual({
      name: "a.md",
    });
    expect(existsSync(join(dir, "a.md"))).toBe(false);
    expect(await client.request("memory.read", { projectId, name: "../x.md" })).toMatchObject({
      ok: false,
      error: { code: "bad_request" },
    });
  });

  test("memory.budget e memory.suggest respondem o que o módulo calcula", async () => {
    const { client, projectId, put } = await served();
    put("MEMORY.md", "- [Some](sumiu.md)\n");
    const budget = await client.data<{
      memory: { indexLines: number; loadedLines: number };
      sources: Array<{ kind: string }>;
    }>("memory.budget", { projectId });
    expect(budget?.memory).toMatchObject({
      indexLines: 1,
      loadedLines: 1,
      limitLines: 200,
      limitBytes: 25600,
    });
    expect(budget?.sources.map((s) => s.kind)).toContain("memory");
    expect(await client.data("memory.suggest", { projectId })).toEqual({
      suggestions: [{ kind: "broken-link", files: ["sumiu.md"], detail: "- [Some](sumiu.md)" }],
    });
  });
});

describe("memoria: o registro das decisões", () => {
  test("cada decisão vira uma linha de JSON no arquivo, na ordem, só com o que o registro tem", () => {
    const file = join(tempDir("fd-log-"), "dados", "memory-decisions.jsonl");
    const record = decisionLog(file);
    const claudeDir = tempDir("fd-claude-");
    const { repo } = gitRepo();
    const memory = new ProjectMemory({ claudeDir, clock: () => Date.UTC(2026, 9, 31, 12), record });
    memory.write(repo, {
      name: "a.md",
      content: "segredo-de-teste\n",
      expectedHash: null,
      confirm: true,
    });
    memory.remove(repo, { name: "a.md", expectedHash: sha("segredo-de-teste\n"), confirm: true });
    const lines = readFileSync(file, "utf8").trim().split("\n");
    expect(lines.map((l) => JSON.parse(l))).toEqual([
      {
        action: "write",
        name: "a.md",
        before: null,
        after: sha("segredo-de-teste\n"),
        at: "2026-10-31T12:00:00.000Z",
      },
      {
        action: "delete",
        name: "a.md",
        before: sha("segredo-de-teste\n"),
        after: null,
        at: "2026-10-31T12:00:00.000Z",
      },
    ]);
    expect(readFileSync(file, "utf8")).not.toContain("segredo-de-teste");
  });
});

describe("memoria: o daemon inteiro", () => {
  test("o daemon de verdade anuncia memory e grava a decisão ao lado dos dados", async () => {
    const base = tempDir("fd-daemon-");
    const { repo } = gitRepo();
    const config = join(base, "config.json");
    writeFileSync(
      config,
      JSON.stringify({
        hostName: "h",
        port: 0,
        token: "memoria-daemon-token-0123456789",
        dataDir: join(base, "data"),
        allowedRoots: [join(repo, "..")],
        runtime: "fake",
        hooks: { port: 0 },
      }),
    );
    const quiet = { log: () => {}, error: () => {} };
    const daemon = await startDaemon({ command: "start", config, runtime: "fake" }, {}, quiet);
    try {
      const client = new FrameClient(daemon.url);
      await client.request("hello", { token: "memoria-daemon-token-0123456789", client: "t" });
      expect((await client.data<{ features: string[] }>("host.info", {}))?.features).toContain(
        "memory",
      );
      const project = await client.data<{ id: string }>("project.add", { path: repo });
      const written = await client.data<{ hash: string }>("memory.write", {
        projectId: project?.id,
        name: "a.md",
        content: "x\n",
        expectedHash: null,
        confirm: true,
      });
      expect(written?.hash).toBe(sha("x\n"));
      const log = readFileSync(join(base, "data", "memory-decisions.jsonl"), "utf8").trim();
      expect(JSON.parse(log)).toMatchObject({ action: "write", name: "a.md", after: sha("x\n") });
      client.close();
    } finally {
      await daemon.stop();
    }
  });
});

describe("memoria: ramos do orçamento e dos nomes", () => {
  test("regras em subpastas entram, arquivos que não são .md e pastas fundas demais ficam de fora, e skills sem SKILL.md ou sem nome são ignoradas", () => {
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
    const paths = ctx.memory
      .budget(ctx.repo)
      .sources.filter((s) => s.kind === "rules" || s.kind === "skills")
      .map((s) => s.path.replace(ctx.repo, "."));
    expect(paths).toEqual(["./.claude/rules/a/b.md"]);
  });

  test("um arquivo de memória que é um link não é lido nem gravado", () => {
    const { memory, repo, dir, put } = setup();
    put("MEMORY.md", "x\n");
    const outside = join(tempDir("fd-outside-"), "alvo.md");
    writeFileSync(outside, "fora\n");
    symlinkSync(outside, join(dir, "link.md"));
    expect(codeOf(() => memory.read(repo, "link.md"))).toBe("bad_request");
    expect(
      codeOf(() =>
        memory.write(repo, {
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
