import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PermissionUpdate } from "@flightdeck/protocol";
import { ruleString } from "../src/board/project-rules.ts";
import { excludeLocalSettings } from "../src/board/worktree.ts";
import { startServer } from "../src/server.ts";
import { cardWhen, git, newBoard } from "./board-helpers.ts";
import { poll, tempDir } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";
import { workflowCard } from "./workflow-helpers.ts";

// Real git in temp repositories (the only place these tests write settings): more than 5 s.
setDefaultTimeout(20_000);

const TOKEN = "rules-token-0123456789abcdef";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const SETTINGS = ".claude/settings.local.json";
const rule = (ruleContent: string): PermissionUpdate => ({
  type: "addRules",
  rules: [{ toolName: "Bash", ruleContent }],
  behavior: "allow",
  destination: "localSettings",
});

/** The JSON of a settings file; `null` while it does not exist. */
const readJson = (file: string) =>
  existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
const writeSettings = (repo: string, value: unknown) => {
  mkdirSync(join(repo, ".claude"), { recursive: true });
  writeFileSync(join(repo, SETTINGS), typeof value === "string" ? value : JSON.stringify(value));
};

async function setup() {
  const ctx = newBoard();
  cleanups.push(() => ctx.board.stop());
  const project = await ctx.board.addProject({ path: ctx.repo, promptTemplate: "" });
  /** Starts a card whose session asks for Bash, and resolves with its open request. */
  const asking = async (title: string) => {
    const card = ctx.board.createCard(project.id, { title, description: "[bash] x" });
    await ctx.board.startCard(card.id);
    const ready = await cardWhen(
      ctx.board,
      card.id,
      (c) => c.sessionStatus === "awaiting_permission",
    );
    const sessionId = ready?.sessionId ?? "";
    const requestId = ctx.store.pendingPermissions(sessionId)[0]?.id ?? "";
    return { card, ready, sessionId, requestId };
  };
  const allow = (requestId: string, updates: PermissionUpdate[]) =>
    ctx.manager.respondPermission({ requestId, decision: "allow", updatedPermissions: updates });
  return { ...ctx, project, asking, allow };
}

describe("regras-projeto", () => {
  test("regra aceita numa sessão de card vai para o settings.local.json da raiz, sem duplicar nem perder chaves", async () => {
    const { repo, asking, allow } = await setup();
    writeSettings(repo, { permissions: { allow: ["Read"], deny: ["Bash(rm:*)"] }, outra: 1 });
    const first = await asking("Primeiro");
    allow(first.requestId, [rule("npm test:*")]);
    expect(readJson(join(repo, SETTINGS))).toEqual({
      permissions: { allow: ["Read", "Bash(npm test:*)"], deny: ["Bash(rm:*)"] },
      outra: 1,
    });
    const second = await asking("Segundo");
    allow(second.requestId, [
      rule("npm test:*"),
      {
        type: "addRules",
        rules: [{ toolName: "Bash", ruleContent: "npm test --silent" }],
        behavior: "allow",
        destination: "session",
      },
    ]);
    // The same rule once; a session suggestion never reaches the file.
    expect(readJson(join(repo, SETTINGS)).permissions.allow).toEqual(["Read", "Bash(npm test:*)"]);
  });

  test("sem arquivo na raiz, a regra o cria; sessão que não é de card não escreve nada", async () => {
    const { repo, manager, store, asking, allow } = await setup();
    const { requestId } = await asking("Novo");
    allow(requestId, [rule("ls:*")]);
    expect(readJson(join(repo, SETTINGS))).toEqual({ permissions: { allow: ["Bash(ls:*)"] } });
    const { sessionId } = manager.create({ cwd: repo, prompt: "[bash] fora" });
    await poll(() => store.pendingPermissions(sessionId).length > 0, 3000);
    allow(store.pendingPermissions(sessionId)[0]?.id ?? "", [rule("pwd:*")]);
    expect(readJson(join(repo, SETTINGS)).permissions.allow).toEqual(["Bash(ls:*)"]);
  });

  test("regra aceita numa etapa agent de workflow também vai para a raiz", async () => {
    const ctx = await workflowCard("steps:\n  - id: a\n    agent: { prompt: '[bash] x' }\n");
    cleanups.push(() => ctx.board.stop());
    await ctx.start();
    const run = await ctx.runWhen(
      (r) => ctx.store.pendingPermissions(r.steps[0]?.sessionId ?? "").length > 0,
    );
    const requestId = ctx.store.pendingPermissions(run?.steps[0]?.sessionId ?? "")[0]?.id ?? "";
    ctx.manager.respondPermission({
      requestId,
      decision: "allow",
      updatedPermissions: [rule("make:*")],
    });
    expect(
      existsSync(join(ctx.repo, SETTINGS)) ? readJson(join(ctx.repo, SETTINGS)) : null,
    ).toEqual({
      permissions: { allow: ["Bash(make:*)"] },
    });
  });

  test("worktree nova recebe a cópia, o arquivo fica no .git/info/exclude e nunca entra no diff", async () => {
    const { repo, board, project, asking } = await setup();
    writeSettings(repo, { permissions: { allow: ["Bash(npm test:*)"] } });
    const { card, ready } = await asking("Cópia");
    const worktree = ready?.worktreePath ?? "";
    const copy = join(worktree, SETTINGS);
    expect(existsSync(copy) ? readJson(copy) : null).toEqual({
      permissions: { allow: ["Bash(npm test:*)"] },
    });
    const exclude = readFileSync(join(repo, ".git", "info", "exclude"), "utf8").split(/\r?\n/);
    expect(exclude).toContain(SETTINGS);
    expect(git(worktree, "status", "--porcelain")).toBe("");
    const diff = await board.diff(card.id);
    expect(diff.files.map((f) => f.path)).not.toContain(SETTINGS);
    expect(project.id).not.toBe("");
  });

  test("a linha do exclude volta a cada execução e antes de gravar a regra, mesmo em worktree antiga", async () => {
    const { repo, board, store, manager, asking, allow } = await setup();
    const excludeFile = join(repo, ".git", "info", "exclude");
    const strip = () =>
      writeFileSync(
        excludeFile,
        readFileSync(excludeFile, "utf8")
          .split(/\r?\n/)
          .filter((line) => line !== SETTINGS)
          .join("\n"),
      );
    const excluded = () => readFileSync(excludeFile, "utf8").split(/\r?\n/).includes(SETTINGS);
    const first = await asking("Antiga");
    manager.respondPermission({ requestId: first.requestId, decision: "allow" });
    await cardWhen(board, first.card.id, (c) => c.sessionStatus === "idle");
    // A worktree made before this phase: no line for the rules file.
    strip();
    await board.startCard(first.card.id);
    const again = await cardWhen(
      board,
      first.card.id,
      (c) => c.sessionId !== first.sessionId && c.sessionStatus === "awaiting_permission",
    );
    expect(excluded()).toBe(true);
    strip();
    const requestId = store.pendingPermissions(again?.sessionId ?? "")[0]?.id ?? "";
    allow(requestId, [rule("ls:*")]);
    expect(excluded()).toBe(true);
    writeSettings(again?.worktreePath ?? "", { permissions: { allow: ["Bash(ls:*)"] } });
    const diff = await board.diff(first.card.id);
    expect(diff.files.map((f) => f.path)).not.toContain(SETTINGS);
  });

  test("um settings.local.json versionado no repositório não é sobrescrito na worktree", async () => {
    const { repo, asking } = await setup();
    writeSettings(repo, { permissions: { allow: ["Versionada"] } });
    git(repo, "add", "-f", SETTINGS);
    git(repo, "commit", "-q", "-m", "settings versionado");
    writeSettings(repo, { permissions: { allow: ["Local"] } });
    const { ready } = await asking("Versionado");
    expect(readJson(join(ready?.worktreePath ?? "", SETTINGS))).toEqual({
      permissions: { allow: ["Versionada"] },
    });
  });

  test("settings.local.json inválido na raiz não é sobrescrito: o card avisa", async () => {
    const { repo, board, asking, allow } = await setup();
    writeSettings(repo, "{ quebrado");
    const { card, requestId } = await asking("Quebrado");
    allow(requestId, [rule("ls:*")]);
    expect(readFileSync(join(repo, SETTINGS), "utf8")).toBe("{ quebrado");
    const notice = (await cardWhen(board, card.id, (c) => c.notice !== null))?.notice ?? "";
    expect(notice).toStartWith("regra não gravada no .claude/settings.local.json:");
  });

  test("rules.list e rules.remove (com confirmação), guardando o resto do arquivo", async () => {
    const { repo, board, project, manager, root } = await setup();
    expect(board.listRules(project.id)).toEqual([]);
    writeSettings(repo, {
      permissions: { allow: ["Read", "Bash(npm test:*)"], ask: ["x"] },
      env: { A: "1" },
    });
    const server = startServer({
      manager,
      board,
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
    expect(await client.data("rules.list", { projectId: project.id })).toEqual({
      rules: ["Read", "Bash(npm test:*)"],
    });
    const unconfirmed = await client.request("rules.remove", {
      projectId: project.id,
      rule: "Read",
    });
    expect(unconfirmed).toMatchObject({ ok: false, error: { code: "invalid_state" } });
    expect(
      await client.data("rules.remove", { projectId: project.id, rule: "Read", confirm: true }),
    ).toEqual({
      rules: ["Bash(npm test:*)"],
    });
    expect(readJson(join(repo, SETTINGS))).toEqual({
      permissions: { allow: ["Bash(npm test:*)"], ask: ["x"] },
      env: { A: "1" },
    });
    const missing = await client.request("rules.remove", {
      projectId: project.id,
      rule: "Nada",
      confirm: true,
    });
    expect(missing).toMatchObject({ ok: false, error: { code: "not_found" } });
  });

  test("fora de um repositório git, garantir o exclude falha com a mensagem do git", () => {
    const outside = tempDir();
    const failed = (() => {
      try {
        excludeLocalSettings(outside);
        return null;
      } catch (error) {
        return (error as { code?: string; message?: string }).code ?? "outro";
      }
    })();
    expect(failed).toBe("invalid_state");
  });

  test("formato da regra: Ferramenta(conteúdo) ou só a ferramenta", () => {
    expect(ruleString({ toolName: "Bash", ruleContent: "mkdir:*" })).toBe("Bash(mkdir:*)");
    expect(ruleString({ toolName: "Write" })).toBe("Write");
  });
});
