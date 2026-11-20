import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { historyExcludes } from "../../src/permissions/auto-approve.ts";
import { ClaudeSdkRuntime, type QueryHandle } from "../../src/runtime/claude-sdk-runtime.ts";
import { cardWhen, newBoard } from "../support/board-helpers.ts";
import { must, poll, tempDir } from "../support/helpers.ts";

import { cleanups, TOKENS, teardown } from "./auto-approve-setup.ts";

afterEach(teardown);

describe("auto-approve: the SDK judge, the folder's project and the history", () => {
  test("consulta pelo SDK isolada: sem settings, sem sessão gravada, sem ferramentas, um turno e saída estruturada", async () => {
    const seen: Options[] = [];
    const result = {
      type: "result",
      subtype: "success",
      structured_output: { decision: "allow", reason: "ok" },
      usage: {
        input_tokens: 300,
        output_tokens: 20,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
      modelUsage: {},
    } as unknown as SDKMessage;
    const runtime = new ClaudeSdkRuntime({
      query: ({ options }) => {
        seen.push(options);
        return {
          async *[Symbol.asyncIterator]() {
            yield result;
          },
          interrupt: async () => {},
          close: () => {},
        } as QueryHandle;
      },
    });
    const dir = tempDir();
    const judged = await runtime.judgePermission({
      model: "claude-haiku-5-5",
      prompt: "p",
      cwd: dir,
    });
    expect(judged).toEqual({
      decision: "allow",
      reason: "ok",
      tokens: { ...TOKENS },
    });
    expect(seen[0]).toMatchObject({
      model: "claude-haiku-5-5",
      cwd: dir,
      maxTurns: 1,
      settingSources: [],
      // settingSources does not cover .mcp.json: the session's folder may be one nobody trusted.
      strictMcpConfig: true,
      persistSession: false,
      tools: [],
      env: expect.objectContaining({ FLIGHTDECK_MANAGED: "1" }),
      outputFormat: { type: "json_schema" },
    });
    // No structured answer (or an odd one) is a question for you.
    const odd = new ClaudeSdkRuntime({
      query: () =>
        ({
          async *[Symbol.asyncIterator]() {
            yield {
              type: "result",
              subtype: "error_max_turns",
              usage: result,
            } as unknown as SDKMessage;
          },
          interrupt: async () => {},
          close: () => {},
        }) as QueryHandle,
    });
    expect(await odd.judgePermission({ model: "m", prompt: "p", cwd: dir })).toMatchObject({
      decision: "ask",
    });
  });

  test("consulta pelo SDK: o sinal aborta a consulta; terminar sem resultado é pergunta", async () => {
    const seen: Options[] = [];
    const runtime = new ClaudeSdkRuntime({
      query: ({ options }) => {
        seen.push(options);
        return {
          async *[Symbol.asyncIterator]() {},
          interrupt: async () => {},
          close: () => {},
        } as QueryHandle;
      },
    });
    const controller = new AbortController();
    const judged = await runtime.judgePermission({
      model: "m",
      prompt: "p",
      cwd: tempDir(),
      signal: controller.signal,
    });
    expect(judged).toEqual({ decision: "ask", reason: "the query ended without a result" });
    expect(seen[0]?.abortController?.signal.aborted).toBe(false);
    controller.abort();
    expect(seen[0]?.abortController?.signal.aborted).toBe(true);
  });

  test("o projeto de uma pasta: o repositório, a worktree de um card (com o card) ou nenhum", async () => {
    const { board, repo, manager } = newBoard();
    cleanups.push(() => board.stop());
    const project = await board.addProject({ path: repo, promptTemplate: "" });
    const card = board.createCard(project.id, { title: "Login", description: "corrigir o login" });
    await board.startCard(card.id);
    const started = await cardWhen(board, card.id, (c) => c.column === "review");
    const worktree = must(started?.worktreePath, "worktreePath");
    expect(board.projectForCwd(join(worktree, "src"))).toMatchObject({
      project: { id: project.id },
      card: { id: card.id, description: "corrigir o login" },
    });
    expect(board.projectForCwd(join(repo, "src"))).toMatchObject({
      project: { id: project.id },
      card: null,
    });
    expect(board.projectForCwd(tempDir())).toBeNull();
    await poll(() => manager.get(started?.sessionId ?? "").status === "idle", 3000);
  });

  test("o cwd da consulta fica fora do histórico", () => {
    expect(
      historyExcludes({ dataDir: "/d", history: { excludeCwds: ["/x"] } }).map((p) =>
        p.replaceAll("\\", "/"),
      ),
    ).toEqual(["/x", "/d/auto-approve", "/d/assistant"]);
  });
});
