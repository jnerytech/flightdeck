import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Command, SecretScanner, SessionRecap } from "@flightdeck/protocol";
import { startServer } from "../src/server.ts";
import { EventStore } from "../src/store/event-store.ts";
import { SummaryService } from "../src/summary/service.ts";
import { newManager, tempDir } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

const SESSION = "cccccccc-0000-4000-8000-000000000030";
const TOKEN = "summary-token-0123456789abcdef";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

function setup(indexed = true) {
  const db = new EventStore(":memory:").db;
  const folder = join(tempDir("fd-summary-"), "projects", "p");
  mkdirSync(folder, { recursive: true });
  const file = join(folder, `${SESSION}.jsonl`);
  writeFileSync(
    file,
    [
      { type: "user", message: { role: "user", content: "Add a retry" } },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "Retry added." },
            { type: "tool_use", name: "Edit", input: { file_path: "/r/queue.ts" } },
          ],
        },
      },
    ]
      .map((entry) => JSON.stringify(entry))
      .join("\n"),
  );
  if (indexed) {
    db.query(
      `INSERT INTO history_sessions (claude_session_id, cwd, title, first_ts, last_ts, message_count, origin, file_path)
       VALUES (?, '/work/app', 't', '2026-11-01T12:00:00.000Z', '2026-11-01T12:01:30.000Z', 2, 'external', ?)`,
    ).run(SESSION, file);
  }
  db.query(
    `INSERT INTO usage_entries (message_id, claude_session_id, at, day, project_key, model, origin,
       speed, input, output, cache_read, cache_write_5m, cache_write_1h, cost_usd)
     VALUES ('m1', ?, '2026-11-01T12:00:00.000Z', '2026-11-01', 'p', 'm', 'terminal', 'standard', 1, 1, 0, 0, 0, 0.4)`,
  ).run(SESSION);
  return { db, service: new SummaryService({ db, scanner: new SecretScanner() }) };
}

describe("resumo-protocolo: the service", () => {
  test("it reads the transcript from disk and prices it from the usage entries", async () => {
    const { service } = setup();
    expect(await service.get(SESSION, { question: "Run it?", state: "waiting" })).toEqual({
      asked: "Add a retry",
      done: "Retry added.",
      files: ["/r/queue.ts"],
      filesMore: 0,
      costUsd: 0.4,
      question: "Run it?",
      state: "waiting",
      source: "transcript",
    });
  });

  test("without a question or a state they are null and idle", async () => {
    const summary = await setup().service.get(SESSION);
    expect(summary.question).toBeNull();
    expect(summary.state).toBe("idle");
  });

  test("the summary is read without blocking: get returns a promise", async () => {
    const pending = setup().service.get(SESSION);
    expect(pending).toBeInstanceOf(Promise);
    await pending;
  });

  test("a transcript that is not indexed is not found", async () => {
    await expect(setup(false).service.get(SESSION)).rejects.toThrow(/not indexed/);
  });
});

describe("resumo-protocolo: over the protocol", () => {
  async function served(withSummary: boolean) {
    const { service } = setup();
    const { manager, root } = newManager();
    const server = startServer({
      manager,
      ...(withSummary ? { summary: service } : {}),
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
    return client;
  }

  test("the host announces summary and session.summary answers with a valid summary", async () => {
    const client = await served(true);
    expect(
      (await client.data<{ features: string[] }>("host.info", {}))?.features.filter(
        (name) => name !== "session.images",
      ),
    ).toContain("summary");
    const data = await client.data("session.summary", { claudeSessionId: SESSION });
    const summary = SessionRecap.parse(data);
    expect(summary.asked).toBe("Add a retry");
  });

  test("a host without it says the feature is off", async () => {
    const client = await served(false);
    const ack = (await client.request("session.summary", { claudeSessionId: SESSION })) as {
      ok: boolean;
      error?: { reason?: string };
    };
    expect(ack.ok).toBe(false);
    expect(ack.error?.reason).toBe("feature_off");
  });

  test("the command checks its payload", async () => {
    const parse = (payload: unknown) =>
      Command.safeParse({ id: "1", type: "session.summary", payload }).success;
    expect(parse({ claudeSessionId: SESSION })).toBe(true);
    expect(parse({ claudeSessionId: SESSION, question: "q", state: "waiting" })).toBe(true);
    expect(parse({ claudeSessionId: "" })).toBe(false);
    expect(parse({ claudeSessionId: SESSION, extra: 1 })).toBe(false);
  });

  test("a summary that does not fit the schema is refused", async () => {
    expect(SessionRecap.safeParse({ asked: "x" }).success).toBe(false);
  });
});
