import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  linkSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { KnowledgeEntry } from "@flightdeck/protocol";
import { listKnowledge } from "../src/knowledge/list.ts";
import { setKnowledgeStatus } from "../src/knowledge/status.ts";
import { startServer } from "../src/server.ts";
import { newManager, tempDir } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

/** Issue #76: the status of a document, written into its front matter and nowhere else. */
const TOKEN = "knowledge-status-token-0123456789a";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const put = (root: string, path: string, text: string | Buffer) => {
  mkdirSync(join(root, path, ".."), { recursive: true });
  writeFileSync(join(root, path), text);
};
const read = (root: string, path: string) => readFileSync(join(root, path), "utf8");
const DOC = "---\ntitle: Use SQLite\nstatus: transitional\n---\n# Use SQLite\n\nBody line\n";
const entryOf = async (root: string, path: string): Promise<KnowledgeEntry> => {
  const found = (await listKnowledge(root)).entries.find((e) => e.path === path);
  return found as KnowledgeEntry;
};
const refusal = async (promise: Promise<unknown>) => {
  const [settled] = await Promise.allSettled([promise]);
  const error = settled?.status === "rejected" ? (settled.reason as Record<string, unknown>) : {};
  return [error.code, error.reason];
};

describe("knowledge-status: the list's hash is what the file looked like (#76)", () => {
  test("it is the same while the file is, and changes with its start or its size", async () => {
    const root = tempDir("fd-status-");
    put(root, "docs/adr/a.md", DOC);
    const first = (await entryOf(root, "docs/adr/a.md")).hash;
    const again = (await entryOf(root, "docs/adr/a.md")).hash;
    put(root, "docs/adr/a.md", DOC.replace("SQLite", "Sqlite"));
    const edited = (await entryOf(root, "docs/adr/a.md")).hash;
    put(root, "docs/adr/a.md", `${DOC}more\n`);
    const longer = (await entryOf(root, "docs/adr/a.md")).hash;
    expect([first.length > 20, again === first, edited !== first, longer !== first]).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(new Set([first, edited, longer]).size).toBe(3);
  });
});

describe("knowledge-status: setting the status of a document (#76)", () => {
  test("writes only the status line, and gives back the entry as it now is", async () => {
    const root = tempDir("fd-status-");
    put(root, "docs/adr/a.md", DOC);
    const shown = await entryOf(root, "docs/adr/a.md");
    const done = await setKnowledgeStatus(root, "docs/adr/a.md", "valid", shown.hash);
    expect(read(root, "docs/adr/a.md")).toBe(DOC.replace("status: transitional", "status: valid"));
    expect([done.status, done.title, done.hash === shown.hash]).toEqual([
      "valid",
      "Use SQLite",
      false,
    ]);
    expect(done).toEqual(await entryOf(root, "docs/adr/a.md"));
  });

  test("a status the library does not know is replaced by one it does, which is how it gets fixed", async () => {
    const root = tempDir("fd-status-");
    put(root, "docs/adr/a.md", DOC.replace("transitional", "draft"));
    const shown = await entryOf(root, "docs/adr/a.md");
    const done = await setKnowledgeStatus(root, "docs/adr/a.md", "valid", shown.hash);
    expect([shown.problems, done.problems, done.status]).toEqual([["status_unknown"], [], "valid"]);
  });

  test("a document with no front matter gets a block with the status alone", async () => {
    const root = tempDir("fd-status-");
    put(root, "docs/rfc/plain.md", "# Plain\n\nBody\n");
    const shown = await entryOf(root, "docs/rfc/plain.md");
    await setKnowledgeStatus(root, "docs/rfc/plain.md", "valid", shown.hash);
    expect(read(root, "docs/rfc/plain.md")).toBe("---\nstatus: valid\n---\n# Plain\n\nBody\n");
  });

  test("the file's mode stays, and no temporary file is left beside it", async () => {
    const root = tempDir("fd-status-");
    put(root, "docs/adr/a.md", DOC);
    chmodSync(join(root, "docs/adr/a.md"), 0o640);
    const shown = await entryOf(root, "docs/adr/a.md");
    await setKnowledgeStatus(root, "docs/adr/a.md", "obsolete", shown.hash);
    const mode = statSync(join(root, "docs/adr/a.md")).mode & 0o777;
    expect([
      read(root, "docs/adr/a.md").includes("status: obsolete"),
      process.platform === "win32" ? 0o640 : mode,
      readdirSync(join(root, "docs/adr")),
    ]).toEqual([true, 0o640, ["a.md"]]);
  });

  test("a file that is not what was listed is refused and left as it is: its start, or its size", async () => {
    const root = tempDir("fd-status-");
    put(root, "docs/adr/a.md", DOC);
    const shown = await entryOf(root, "docs/adr/a.md");
    // Same size, one letter different near the top.
    const sameSize = DOC.replace("SQLite", "SQLitf");
    put(root, "docs/adr/a.md", sameSize);
    const start = await refusal(setKnowledgeStatus(root, "docs/adr/a.md", "valid", shown.hash));
    const longer = `${sameSize}added\n`;
    put(root, "docs/adr/a.md", longer);
    const size = await refusal(setKnowledgeStatus(root, "docs/adr/a.md", "valid", shown.hash));
    expect([start, size, read(root, "docs/adr/a.md")]).toEqual([
      ["file_conflict", "review_file_changed"],
      ["file_conflict", "review_file_changed"],
      longer,
    ]);
  });

  test("only a document of the library is changed: not another file, a credential name, a link or a path that climbs", async () => {
    const root = tempDir("fd-status-");
    const outside = tempDir("fd-status-out-");
    put(root, "README.md", DOC);
    put(root, "docs/other/x.md", DOC);
    put(root, "docs/adr/.env.md", DOC);
    put(outside, "secret.md", DOC);
    mkdirSync(join(root, "docs/adr"), { recursive: true });
    symlinkSync(join(outside, "secret.md"), join(root, "docs/adr/link.md"));
    put(root, "docs/adr/real.md", DOC);
    linkSync(join(root, "docs/adr/real.md"), join(root, "docs/adr/hard.md"));
    const asked = [
      "README.md",
      "docs/other/x.md",
      "docs/adr/.env.md",
      "docs/adr/link.md",
      "docs/adr/hard.md",
      "docs/adr/../../README.md",
      "docs/adr/missing.md",
    ];
    const results = await Promise.all(
      asked.map((file) => refusal(setKnowledgeStatus(root, file, "valid", "any"))),
    );
    expect(results).toEqual(asked.map(() => ["not_found", "review_file_missing"]));
    expect([
      read(root, "README.md"),
      read(root, "docs/other/x.md"),
      read(outside, "secret.md"),
    ]).toEqual([DOC, DOC, DOC]);
  });

  test("a front matter that is not clear is refused, with the file untouched", async () => {
    const root = tempDir("fd-status-");
    const text = "---\nstatus: valid\n# never closed\n";
    put(root, "docs/adr/a.md", text);
    const shown = await entryOf(root, "docs/adr/a.md");
    const result = await refusal(setKnowledgeStatus(root, "docs/adr/a.md", "obsolete", shown.hash));
    expect([result, read(root, "docs/adr/a.md")]).toEqual([
      ["bad_request", "knowledge_frontmatter"],
      text,
    ]);
  });

  test("a front matter that closes only past what the list read is refused too", async () => {
    const root = tempDir("fd-status-");
    const pad = `note: ${"x".repeat(9000)}\n`;
    const text = `---\n${pad}status: valid\n---\n# Late\n`;
    put(root, "docs/adr/a.md", text);
    const shown = await entryOf(root, "docs/adr/a.md");
    const result = await refusal(setKnowledgeStatus(root, "docs/adr/a.md", "obsolete", shown.hash));
    expect([result, read(root, "docs/adr/a.md")]).toEqual([
      ["bad_request", "knowledge_frontmatter"],
      text,
    ]);
  });

  test("a file over 1 MB or one that is not text is refused", async () => {
    const root = tempDir("fd-status-");
    put(root, "docs/adr/big.md", `${DOC}${"x".repeat(1024 * 1024 + 10)}\n`);
    put(root, "docs/adr/bin.md", Buffer.concat([Buffer.from(DOC), Buffer.from([0, 1, 2])]));
    const big = await entryOf(root, "docs/adr/big.md");
    const bin = await entryOf(root, "docs/adr/bin.md");
    expect([
      await refusal(setKnowledgeStatus(root, "docs/adr/big.md", "valid", big.hash)),
      await refusal(setKnowledgeStatus(root, "docs/adr/bin.md", "valid", bin.hash)),
    ]).toEqual([
      ["bad_request", "review_file_big"],
      ["bad_request", "review_file_binary"],
    ]);
  });
});

describe("knowledge-status: over the protocol (#76)", () => {
  const start = (withIt: boolean) => {
    const ctx = newManager();
    const server = startServer({
      manager: ctx.manager,
      ...(withIt ? { knowledgeStatus: setKnowledgeStatus } : {}),
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [ctx.root],
    });
    cleanups.push(() => server.stop());
    return { ctx, server };
  };

  test("the host announces it and writes the status; a folder outside the roots is refused", async () => {
    const { ctx, server } = start(true);
    put(ctx.project, "docs/adr/a.md", DOC);
    const shown = await entryOf(ctx.project, "docs/adr/a.md");
    const client = new FrameClient(server.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    const info = await client.data<{ features?: string[] }>("host.info", {});
    const done = await client.data<KnowledgeEntry>("knowledge.setStatus", {
      path: ctx.project,
      file: "docs/adr/a.md",
      status: "valid",
      expectedHash: shown.hash,
    });
    const outside = await client.request("knowledge.setStatus", {
      path: tempDir("fd-status-out-"),
      file: "docs/adr/a.md",
      status: "valid",
      expectedHash: shown.hash,
    });
    expect([
      info?.features?.includes("knowledgeStatus"),
      done?.status,
      read(ctx.project, "docs/adr/a.md").includes("status: valid"),
      outside.ok,
    ]).toEqual([true, "valid", true, false]);
  });

  test("a host without it refuses the command", async () => {
    const { ctx, server } = start(false);
    const client = new FrameClient(server.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    const refused = await client.request("knowledge.setStatus", {
      path: ctx.project,
      file: "docs/adr/a.md",
      status: "valid",
      expectedHash: "h",
    });
    expect(refused.ok).toBe(false);
  });
});
