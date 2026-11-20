import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { type AutoApproveRequest, AutoApprover } from "../../src/permissions/auto-approve.ts";
import { autoApproveDir } from "../../src/permissions/domain/auto-approve-rules.ts";
import { RiskClassifier } from "../../src/permissions/domain/risk.ts";
import { FakeRuntime } from "../../src/runtime/fake-runtime.ts";
import type { JudgeResult } from "../../src/runtime/types.ts";
import { EventStore } from "../../src/store/event-store.ts";
import { tempDir } from "../support/helpers.ts";

import { cleanups, ON, setup, TOKENS, teardown } from "./auto-approve-setup.ts";

afterEach(teardown);

describe("auto-approve: decisions, log and suspension", () => {
  test("desligada ou fora de um projeto: não decide nem consulta a IA", async () => {
    const off = setup({ settings: { ...ON, enabled: false } });
    expect(await off.auto.decide(off.request("Write", { file_path: "a" }, "medium"))).toBeNull();
    const outside = setup();
    expect(
      await outside.auto.decide({
        ...outside.request("Write", { file_path: "a" }, "medium"),
        cwd: tempDir(),
      }),
    ).toBeNull();
    expect([...off.runtime.judgeCalls, ...outside.runtime.judgeCalls]).toEqual([]);
  });

  test("o run_with_secret do MCP nunca é automático, nem com a IA dizendo allow e sem consultá-la", async () => {
    const { auto, request, runtime, cwd } = setup();
    const classified = new RiskClassifier({ allowedRoots: [cwd], home: tempDir() }).classify(
      "mcp__flightdeck__run_with_secret",
      { command: "deploy.sh", secrets: ["token"] },
      cwd,
    );
    const decision = await auto.decide(
      request(
        "mcp__flightdeck__run_with_secret",
        { command: "deploy.sh", secrets: ["token"] },
        classified.level,
        classified.network,
      ),
    );
    expect(decision).toMatchObject({ decision: "ask", by: "rule" });
    expect(runtime.judgeCalls).toEqual([]);
  });

  test("high nunca é automático, nem com a IA dizendo allow; rede também nunca", async () => {
    const { auto, request, runtime } = setup();
    expect(await auto.decide(request("Bash", { command: "rm -rf build" }, "high"))).toMatchObject({
      decision: "ask",
      by: "rule",
    });
    expect(
      await auto.decide(request("WebFetch", { url: "https://x.example" }, "medium", true)),
    ).toMatchObject({ decision: "ask", by: "rule" });
    expect(runtime.judgeCalls).toEqual([]);
  });

  test("low aprova sem IA com lowWithoutAi; sem a opção, low passa pela IA", async () => {
    const withRule = setup();
    expect(await withRule.auto.decide(withRule.request("Read", { file_path: "a" }, "low"))).toEqual(
      { decision: "allow", reason: expect.any(String), by: "rule", model: null },
    );
    expect(withRule.runtime.judgeCalls).toEqual([]);
    const withAi = setup({ settings: { ...ON, lowWithoutAi: false } });
    expect(
      await withAi.auto.decide(withAi.request("Read", { file_path: "a" }, "low")),
    ).toMatchObject({ decision: "allow", by: "ai", model: "claude-haiku-5-5" });
    expect(withAi.runtime.judgeCalls).toHaveLength(1);
  });

  test("medium pela IA: allow aprova; ask, erro e timeout vão para você; a IA nunca nega", async () => {
    const answers: Record<string, () => JudgeResult | Promise<JudgeResult>> = {
      Write: () => ({ decision: "allow", reason: "dentro do pedido" }),
      Edit: () => ({ decision: "ask", reason: "na dúvida" }),
      Bash: () => ({ decision: "deny", reason: "perigoso" }),
      NotebookEdit: () => {
        throw new Error("modelo fora do ar");
      },
      Task: () => new Promise(() => {}),
    };
    const { auto, request } = setup({
      judge: (o) => (answers[/ferramenta: (\w+)/.exec(o.prompt)?.[1] ?? ""] as () => JudgeResult)(),
      timeoutMs: 200,
    });
    const decide = (tool: string) => auto.decide(request(tool, { file_path: "a" }, "medium"));
    expect(await decide("Write")).toMatchObject({ decision: "allow", by: "ai" });
    expect(await decide("Edit")).toMatchObject({ decision: "ask", by: "ai" });
    // A "no" from the AI becomes a question for you, never a denial.
    expect(await decide("Bash")).toMatchObject({ decision: "ask", by: "ai" });
    expect(await decide("NotebookEdit")).toMatchObject({
      decision: "ask",
      reason: expect.stringContaining("modelo fora do ar"),
    });
    expect(await decide("Task")).toMatchObject({
      decision: "ask",
      reason: expect.stringContaining("0.2 s"),
    });
  });

  test("a pergunta: modelo, cwd próprio, ferramenta, entrada cortada, descrição do card e a política", async () => {
    const { auto, request, runtime, dataDir, cwd } = setup();
    await auto.decide(
      request("Write", { file_path: "a.txt", content: "x".repeat(5000) }, "medium"),
    );
    const [call] = runtime.judgeCalls;
    expect(call?.model).toBe("claude-haiku-5-5");
    expect(call?.cwd).toBe(autoApproveDir(dataDir));
    expect(autoApproveDir(dataDir)).toBe(join(dataDir, "auto-approve"));
    expect(call?.prompt).toContain("ferramenta: Write");
    expect(call?.prompt).toContain(cwd);
    expect(call?.prompt).toContain("corrigir o login");
    expect(call?.prompt).toContain("na dúvida");
    expect(call?.prompt.length).toBeLessThan(3000);
  });

  test("suspensa numa sessão (conteúdo de terceiro): medium vai para você até reativar; sobrevive ao reinício", async () => {
    const { auto, request, store, runtime, dataDir } = setup();
    auto.suspend("s1", "conteúdo de terceiro no card");
    expect(await auto.decide(request("Write", { file_path: "a" }, "medium"))).toMatchObject({
      decision: "ask",
      reason: expect.stringContaining("suspensa"),
    });
    expect(
      await auto.decide(request("Write", { file_path: "a" }, "medium", false, "s2")),
    ).toMatchObject({ decision: "allow" });
    const again = new AutoApprover({ db: store.db, runtime, dataDir, context: () => null });
    expect(again.suspended()).toMatchObject([
      { sessionKey: "s1", reason: "conteúdo de terceiro no card" },
    ]);
    auto.resume("s1");
    expect(await auto.decide(request("Write", { file_path: "a" }, "medium"))).toMatchObject({
      decision: "allow",
    });
    expect(auto.suspended()).toEqual([]);
  });

  test("suspensa num card (issue de terceiro): vale para as sessões dele, não para as de outros cards", async () => {
    const cwd = tempDir("fd-auto-");
    const other = tempDir("fd-auto-");
    const store = new EventStore(":memory:");
    cleanups.push(() => store.close());
    const runtime = new FakeRuntime();
    const auto = new AutoApprover({
      db: store.db,
      runtime,
      dataDir: tempDir(),
      context: (dir) => ({
        projectId: "p1",
        settings: ON,
        cardId: dir === cwd ? "c1" : "c2",
      }),
    });
    auto.suspend("card:c1", "issue de autor de fora");
    const ask = (dir: string, sessionKey: string): AutoApproveRequest => ({
      sessionKey,
      requestId: "r",
      toolName: "Write",
      input: {},
      cwd: dir,
      risk: { level: "medium", reason: "x", network: false },
    });
    expect(await auto.decide(ask(cwd, "qualquer-sessao"))).toMatchObject({
      decision: "ask",
      reason: expect.stringContaining("issue de autor de fora"),
    });
    expect(await auto.decide(ask(other, "qualquer-sessao"))).toMatchObject({ decision: "allow" });
    auto.resume("card:c1");
    expect(await auto.decide(ask(cwd, "qualquer-sessao"))).toMatchObject({ decision: "allow" });
  });

  test("suspendCard keeps approval off on a card's sessions with the reason it was given, and only there", async () => {
    const cwd = tempDir("fd-auto-");
    const other = tempDir("fd-auto-");
    const store = new EventStore(":memory:");
    cleanups.push(() => store.close());
    const auto = new AutoApprover({
      db: store.db,
      runtime: new FakeRuntime(),
      dataDir: tempDir(),
      context: (dir) => ({ projectId: "p1", settings: ON, cardId: dir === cwd ? "c1" : "c2" }),
    });
    auto.suspendCard("c1", "card raised from an agent's findings");
    const ask = (dir: string): AutoApproveRequest => ({
      sessionKey: "s",
      requestId: "r",
      toolName: "Write",
      input: {},
      cwd: dir,
      risk: { level: "medium", reason: "x", network: false },
    });
    expect(await auto.decide(ask(cwd))).toMatchObject({
      decision: "ask",
      reason: expect.stringContaining("card raised from an agent's findings"),
    });
    expect(await auto.decide(ask(other))).toMatchObject({ decision: "allow" });
    expect(auto.suspended().map((entry) => entry.sessionKey)).toEqual(["card:c1"]);
  });

  test("registro: cada decisão em auto_approvals, com filtros; a consulta entra no uso com origem auto-approve", async () => {
    const { auto, request, store } = setup({
      judge: () => ({ decision: "allow", reason: "seguro", tokens: TOKENS }),
    });
    await auto.decide(request("Read", { file_path: "a" }, "low"));
    await auto.decide(request("Write", { file_path: "a" }, "medium", false, "s2"));
    await auto.decide(request("Bash", { command: "rm -rf x" }, "high"));
    expect(auto.list().map((r) => [r.toolName, r.risk, r.decision, r.by])).toEqual([
      ["Bash", "high", "ask", "rule"],
      ["Write", "medium", "allow", "ai"],
      ["Read", "low", "allow", "rule"],
    ]);
    expect(auto.list({ sessionKey: "s2" }).map((r) => r.toolName)).toEqual(["Write"]);
    expect(auto.list({ projectId: "outro" })).toEqual([]);
    expect(auto.list({ limit: 1 })).toHaveLength(1);
    expect(
      store.db.query("SELECT origin, model, input, output, project_key FROM usage_entries").all(),
    ).toEqual([
      {
        origin: "auto-approve",
        model: "claude-haiku-5-5",
        input: 300,
        output: 20,
        project_key: "github.com/acme/app",
      },
    ]);
  });
});
