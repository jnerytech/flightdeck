import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { KnowledgeEntry } from "@flightdeck/protocol";
import { createKnowledgeDoc } from "../src/knowledge/create.ts";
import { startServer } from "../src/server.ts";
import { BASELINE_FEATURES, newManager, workspace } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

/** Issue #1039: the host announces and serves "new document from a template". */
const TOKEN = "knowledge-create-token-0123456789";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function serve(withCreate = true) {
  const { root, project } = workspace();
  mkdirSync(project, { recursive: true });
  const server = startServer({
    manager: newManager().manager,
    ...(withCreate ? { knowledgeCreate: createKnowledgeDoc } : {}),
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
  return { client, project, root };
}

describe("knowledge-create-wire: a document from a template over the wire (#1039)", () => {
  test("a host with the writer announces knowledgeCreate, and one without does not", async () => {
    const on = await serve();
    const off = await serve(false);
    const names = async (client: FrameClient) =>
      ((await client.data<{ features: string[] }>("host.info", {}))?.features ?? []).filter(
        (name) => !BASELINE_FEATURES.includes(name),
      );
    expect([
      (await names(on.client)).includes("knowledgeCreate"),
      (await names(off.client)).includes("knowledgeCreate"),
    ]).toEqual([true, false]);
  });

  test("knowledge.create writes the document in a project of the host and answers its entry", async () => {
    const { client, project } = await serve();
    const entry = await client.data<KnowledgeEntry>("knowledge.create", {
      path: project,
      kind: "adr",
      title: "Use SQLite",
    });
    expect([entry?.path, entry?.status, existsSync(join(project, entry?.path ?? "nope"))]).toEqual([
      "docs/adr/0001-use-sqlite.md",
      "transitional",
      true,
    ]);
  });

  test("a folder outside the host's allowed roots is refused, and so is a host without the writer", async () => {
    const { client, project } = await serve();
    const outside = await client.request("knowledge.create", {
      path: join(project, "..", "..", "elsewhere"),
      kind: "adr",
      title: "Out",
    });
    const bare = await serve(false);
    const without = await bare.client.request("knowledge.create", {
      path: bare.project,
      kind: "adr",
      title: "No",
    });
    expect([outside.ok, without.ok]).toEqual([false, false]);
    expect(existsSync(join(bare.project, "docs"))).toBe(false);
  });

  test("a title with no letter is refused with its reason", async () => {
    const { client, project } = await serve();
    const ack = await client.request("knowledge.create", {
      path: project,
      kind: "rfc",
      title: "???",
    });
    expect([ack.ok, (ack.error as { reason?: string } | undefined)?.reason]).toEqual([
      false,
      "knowledge_title_invalid",
    ]);
  });
});
