import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { KnowledgeListResult } from "@flightdeck/protocol";
import { startDaemon } from "../src/main.ts";
import { tempDir, workspace } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

/** Issue #76: the daemon announces and serves the change of a document's status. */
const TOKEN = "knowledge-status-daemon-token-01234";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

describe("knowledge-status-daemon: the host changes a status on request (#76)", () => {
  test("the list's hash lets the app change one document, and the file is left changed, not committed", async () => {
    const dir = tempDir();
    const { root } = workspace();
    const project = join(root, "app");
    mkdirSync(join(project, "docs/adr"), { recursive: true });
    const doc = join(project, "docs/adr/0001-a.md");
    writeFileSync(doc, "---\nstatus: transitional\n---\n# Use SQLite\n");
    const file = join(dir, "config.json");
    writeFileSync(
      file,
      JSON.stringify({
        port: 0,
        token: TOKEN,
        dataDir: join(dir, "data"),
        allowedRoots: [root],
        history: { roots: [join(dir, "nada")] },
      }),
    );
    const running = await startDaemon(
      { command: "start", config: file, runtime: "fake" },
      {},
      { log: () => {}, error: () => {} },
    );
    cleanups.push(() => running.stop());
    const client = new FrameClient(`ws://127.0.0.1:${new URL(running.url).port}/v1/ws`);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    const info = await client.data<{ features?: string[] }>("host.info", {});
    const listed = await client.data<KnowledgeListResult>("knowledge.list", { path: project });
    const entry = listed?.entries[0];
    const done = await client.data<{ status: string }>("knowledge.setStatus", {
      path: project,
      file: "docs/adr/0001-a.md",
      status: "valid",
      expectedHash: entry?.hash ?? "none",
    });
    expect([
      info?.features?.includes("knowledgeStatus"),
      done?.status,
      readFileSync(doc, "utf8"),
    ]).toEqual([true, "valid", "---\nstatus: valid\n---\n# Use SQLite\n"]);
  });
});
