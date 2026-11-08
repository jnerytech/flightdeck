import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { KnowledgeIndexResult } from "@flightdeck/protocol";
import { startDaemon } from "../src/main.ts";
import { tempDir, workspace } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

/** Issue #76: the daemon gives the index to a trusted project, unless the config switches it off. */
const TOKEN = "knowledge-feed-daemon-token-0123456789";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const adr = (root: string, title: string) => {
  mkdirSync(join(root, "docs/adr"), { recursive: true });
  writeFileSync(join(root, "docs/adr/0001-a.md"), `---\nstatus: valid\n---\n# ${title}\n`);
};

async function daemon(feedOff: (root: string) => string[]) {
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
      knowledge: { feedOff: feedOff(root) },
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
  const index = async (path: string) =>
    (await client.data<KnowledgeIndexResult>("knowledge.index", { path })) ?? null;
  const trust = (path: string) => client.request("project.trust.set", { path, trusted: true });
  return { root, index, trust };
}

describe("knowledge-feed-daemon: the host decides who is given the index (#76)", () => {
  test("a project the person trusts is given its index; an untrusted one is not", async () => {
    const { root, index, trust } = await daemon(() => []);
    const trusted = join(root, "trusted");
    const untrusted = join(root, "untrusted");
    adr(trusted, "Use SQLite");
    adr(untrusted, "Use Postgres");
    await trust(trusted);
    const given = await index(trusted);
    const withheld = await index(untrusted);
    expect([given?.text.includes("Use SQLite"), given?.fed, withheld?.text, withheld?.fed]).toEqual(
      [true, 1, "", 0],
    );
  });

  test("a folder named in knowledge.feedOff is given nothing, trusted or not", async () => {
    const { root, index, trust } = await daemon((r) => [join(r, "off")]);
    const off = join(root, "off");
    adr(off, "Use SQLite");
    await trust(off);
    expect(await index(off)).toEqual({ text: "", fed: 0, truncated: false });
  });
});
