import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { KnowledgeFeedState, KnowledgeIndexResult } from "@flightdeck/protocol";
import { startDaemon } from "../src/main.ts";
import { tempDir, workspace } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

/** Issue #76: the person switches the index on or off for a project; the host's config keeps it. */
const TOKEN = "knowledge-switch-daemon-token-0123456";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const adr = (root: string) => {
  mkdirSync(join(root, "docs/adr"), { recursive: true });
  writeFileSync(join(root, "docs/adr/0001-a.md"), "---\nstatus: valid\n---\n# Use SQLite\n");
};

async function daemon(extra: Record<string, unknown> = {}) {
  const dir = tempDir();
  const { root } = workspace();
  const file = join(dir, "config.json");
  writeFileSync(
    file,
    JSON.stringify({
      port: 0,
      token: TOKEN,
      dataDir: join(dir, "data"),
      allowedRoots: [root],
      history: { roots: [join(dir, "nada")] },
      ...extra,
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
  const state = (path: string) => client.data<KnowledgeFeedState>("knowledge.feed", { path });
  const set = (path: string, enabled: boolean) =>
    client.data<KnowledgeFeedState>("knowledge.setFeed", { path, enabled });
  const index = (path: string) => client.data<KnowledgeIndexResult>("knowledge.index", { path });
  const raw = () => JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  return { client, root, state, set, index, raw };
}

describe("knowledge-switch-daemon: the switch lives in the host's config (#76)", () => {
  test("the host announces knowledgeFeed, and a folder outside the allowed roots is refused", async () => {
    const { client } = await daemon();
    const info = await client.data<{ features?: string[] }>("host.info", {});
    const outside = await client.request("knowledge.setFeed", {
      path: tempDir("fd-switch-out-"),
      enabled: false,
    });
    expect([info?.features?.includes("knowledgeFeed"), outside.ok]).toEqual([true, false]);
  });

  test("switching a project off stops its index at once and writes only knowledge.feedOff", async () => {
    const { root, state, set, index, raw, client } = await daemon();
    const project = join(root, "app");
    adr(project);
    await client.request("project.trust.set", { path: project, trusted: true });
    const before = raw();
    const given = await index(project);
    const off = await set(project, false);
    const after = raw();
    expect([given?.fed, off?.on, off?.offBy, (await index(project))?.fed]).toEqual([
      1,
      false,
      project,
      0,
    ]);
    expect(after).toEqual({ ...before, knowledge: { feedOff: [project] } });
    expect((await state(project))?.offBy).toBe(project);
  });

  test("switching it on again takes the project out of the list and the index comes back", async () => {
    const { root, set, index, raw, client } = await daemon();
    const project = join(root, "app");
    adr(project);
    await client.request("project.trust.set", { path: project, trusted: true });
    await set(project, false);
    const on = await set(project, true);
    expect([
      on?.on,
      (raw().knowledge as { feedOff?: string[] } | undefined)?.feedOff,
      (await index(project))?.fed,
    ]).toEqual([true, [], 1]);
  });

  test("a project off by a folder above it cannot be switched on from there", async () => {
    const { root, set } = await daemon({ knowledge: { feedOff: [] } });
    const above = join(root, "team");
    const project = join(above, "app");
    mkdirSync(project, { recursive: true });
    await set(above, false);
    const on = await set(project, true);
    expect([on?.on, on?.offBy]).toEqual([false, above]);
  });
});
