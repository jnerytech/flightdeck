import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { Command, ServerMessage } from "@flightdeck/protocol";
import { startServer } from "../src/server.ts";
import { poll } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";
import { commitWorkflow, sha256, workflowCard } from "./workflow-helpers.ts";

// Real git in temp repositories and several turns per test: more than the default 5 s.
setDefaultTimeout(20_000);

const TOKEN = "workflow-token-0123456789abcdef";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const YAML = `inputs: [task]
steps:
  - id: plan
    agent: { prompt: "plano de {{inputs.task}}" }
  - id: approve
    gate: { message: "Aprovar?", show: "{{steps.plan.output}}" }
  - id: implement
    agent: { prompt: "implemente: {{steps.approve.output}}" }
`;

interface WireRun {
  id: string;
  cardId: string;
  status: string;
  steps: Array<{ stepId: string; status: string; output: string | null }>;
}

async function serve(yaml = YAML) {
  const ctx = await workflowCard(yaml);
  cleanups.push(() => ctx.board.stop());
  const server = startServer({
    manager: ctx.manager,
    board: ctx.board,
    hostName: "h",
    bind: "127.0.0.1",
    port: 0,
    token: TOKEN,
    allowedRoots: [ctx.root],
  });
  cleanups.push(() => server.stop());
  const connect = async () => {
    const client = new FrameClient(server.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    return client;
  };
  return { ...ctx, server, connect };
}

/** `run.updated` frames received so far, in order. */
const runFrames = (client: FrameClient): WireRun[] =>
  client.frames.filter((f) => f.type === "run.updated").map((f) => f.run as WireRun);

const runFrame = (client: FrameClient, check: (run: WireRun) => boolean) =>
  poll(() => runFrames(client).find(check), 5000);

describe("protocolo-workflow", () => {
  test("workflow.list, workflow.validate e workflow.trust pelo protocolo", async () => {
    const { connect, project, repo } = await serve();
    const other = "steps:\n  - id: lint\n    check: fd-lint\n";
    commitWorkflow(repo, "outro", other);
    const client = await connect();
    const listed = await client.data<{ workflows: Array<{ name: string; trusted: boolean }> }>(
      "workflow.list",
      { projectId: project.id },
    );
    expect(listed?.workflows.map((w) => [w.name, w.trusted])).toEqual([
      ["outro", false],
      ["wf", true],
    ]);
    expect(
      await client.data("workflow.validate", { projectId: project.id, name: "outro" }),
    ).toEqual({
      name: "outro",
      hash: sha256(other),
      trusted: false,
      checks: ["fd-lint"],
      errors: [],
      inputs: [],
    });
    const wrong = await client.request("workflow.trust", {
      projectId: project.id,
      name: "outro",
      hash: "x",
    });
    expect(wrong).toMatchObject({ ok: false, error: { code: "invalid_state" } });
    const trusted = await client.data<{ trusted: boolean }>("workflow.trust", {
      projectId: project.id,
      name: "outro",
      hash: sha256(other),
    });
    expect(trusted?.trusted).toBe(true);
    const missing = await client.request("workflow.validate", {
      projectId: project.id,
      name: "nada",
    });
    expect(missing).toMatchObject({ ok: false, error: { code: "not_found" } });
  });

  test("card.start com workflow e inputs; run.watch e run.get acompanham; gate.respond aprova", async () => {
    const { connect, card } = await serve();
    const client = await connect();
    expect((await client.request("run.watch", {})).ok).toBe(true);
    const started = await client.data<{ workflowRunId: string | null }>("card.start", {
      cardId: card.id,
      workflow: "wf",
      inputs: { task: "somar" },
    });
    const runId = started?.workflowRunId ?? "";
    expect(runId).not.toBe("");
    const atGate = await runFrame(client, (r) => r.id === runId && r.status === "waiting");
    expect(atGate?.steps.map((s) => [s.stepId, s.status])).toEqual([
      ["plan", "completed"],
      ["approve", "waiting"],
    ]);
    expect((await client.data<WireRun>("run.get", { runId }))?.status).toBe("waiting");
    const answered = await client.data<WireRun>("gate.respond", {
      runId,
      stepId: "approve",
      attempt: 1,
      decision: "approve",
      note: "ok",
    });
    expect(answered?.steps[1]?.status).toBe("approved");
    const done = await runFrame(client, (r) => r.id === runId && r.status === "completed");
    expect(done?.steps[2]?.output).toBe("Echo: implemente: ok");
    for (const frame of client.frames.filter((f) => f.type === "run.updated")) {
      expect(ServerMessage.safeParse(frame).success).toBe(true);
    }
    expect((await client.data<{ id: string }>("card.get", { cardId: card.id }))?.id).toBe(card.id);
  });

  test("run.watch manda as execuções em andamento ao se inscrever, de novo a cada conexão", async () => {
    const { connect, card, start, runWhen } = await serve();
    await start({ task: "x" });
    const waiting = await runWhen((r) => r.status === "waiting");
    const client = await connect();
    expect((await client.request("run.watch", {})).ok).toBe(true);
    const snapshot = await runFrame(client, (r) => r.id === waiting?.id);
    expect(snapshot).toMatchObject({ cardId: card.id, status: "waiting" });
  });

  test("um watcher que lança não quebra a execução nem os outros watchers", async () => {
    const { board, start, runWhen } = await serve("steps:\n  - id: a\n    agent: { prompt: a }\n");
    const seen: string[] = [];
    board.workflows.watch(() => {
      throw new Error("watcher quebrado");
    });
    board.workflows.watch((run) => seen.push(run.status));
    const started = await start().then(
      () => "ok",
      (error: Error) => error.message,
    );
    expect(started).toBe("ok");
    expect((await runWhen((r) => r.endedAt !== null))?.status).toBe("completed");
    expect(seen.at(-1)).toBe("completed");
  });

  test("erros: execução inexistente, gate fechado e payload inválido", async () => {
    const { connect, start, runWhen } = await serve();
    const client = await connect();
    expect(await client.request("run.get", { runId: "nada" })).toMatchObject({
      ok: false,
      error: { code: "not_found" },
    });
    await start({ task: "x" });
    const run = await runWhen((r) => r.status === "waiting");
    const closed = { runId: run?.id, stepId: "plan", attempt: 1, decision: "approve" };
    expect(await client.request("gate.respond", closed)).toMatchObject({
      ok: false,
      error: { code: "invalid_state", message: "gate plan (tentativa 1) não está aberto" },
    });
    const bad = { ...closed, stepId: "approve", decision: "talvez" };
    expect(await client.request("gate.respond", bad)).toMatchObject({
      ok: false,
      error: { code: "bad_request" },
    });
    expect(
      Command.safeParse({ id: "1", type: "card.start", payload: { cardId: "c", inputs: { a: 1 } } })
        .success,
    ).toBe(false);
  });
});
