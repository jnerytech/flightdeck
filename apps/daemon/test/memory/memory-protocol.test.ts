import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startDaemon } from "../../src/main.ts";
import { decisionLog, type MemoryDecision, ProjectMemory } from "../../src/memory/memory.ts";
import { startServer } from "../../src/server.ts";
import { gitRepo, newBoard } from "../support/board-helpers.ts";
import { BASELINE_FEATURES, tempDir } from "../support/helpers.ts";
import { FrameClient } from "../support/history-helpers.ts";

import { sha, slugOf } from "../support/memory.ts";

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
      ...(withMemory ? { agentSetup: { memory } } : {}),
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
    expect(
      (await on.client.data<{ features: string[] }>("host.info", {}))?.features.filter(
        (name) => !BASELINE_FEATURES.includes(name),
      ),
    ).toContain("memory");
    const off = await served(false);
    expect(
      (await off.client.data<{ features: string[] }>("host.info", {}))?.features.filter(
        (name) => !BASELINE_FEATURES.includes(name),
      ),
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
  test("cada decisão vira uma linha de JSON no arquivo, na ordem, só com o que o registro tem", async () => {
    const file = join(tempDir("fd-log-"), "dados", "memory-decisions.jsonl");
    const record = decisionLog(file);
    const decision: MemoryDecision = {
      action: "write",
      name: "x.md",
      before: null,
      after: "h",
      at: "2026-11-03T00:00:00.000Z",
    };
    const written = record(decision);
    expect(written).toBeInstanceOf(Promise);
    await written;
    expect(readFileSync(file, "utf8")).toBe(`${JSON.stringify(decision)}\n`);
    rmSync(file);
    const claudeDir = tempDir("fd-claude-");
    const { repo } = gitRepo();
    const memory = new ProjectMemory({ claudeDir, clock: () => Date.UTC(2026, 9, 31, 12), record });
    await memory.write(repo, {
      name: "a.md",
      content: "segredo-de-teste\n",
      expectedHash: null,
      confirm: true,
    });
    await memory.remove(repo, {
      name: "a.md",
      expectedHash: sha("segredo-de-teste\n"),
      confirm: true,
    });
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
      expect(
        (await client.data<{ features: string[] }>("host.info", {}))?.features.filter(
          (name) => !BASELINE_FEATURES.includes(name),
        ),
      ).toContain("memory");
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
