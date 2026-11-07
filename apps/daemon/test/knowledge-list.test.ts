import { afterEach, describe, expect, test } from "bun:test";
import { link, mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { listKnowledge } from "../src/knowledge/list.ts";
import { startServer } from "../src/server.ts";
import { newManager, tempDir } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

/** Issue #76: the project's library of documents, read only: the folders, the status and the warnings. */
const TOKEN = "knowledge-token-0123456789abcdef";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const put = async (root: string, path: string, text: string) => {
  await mkdir(join(root, path, ".."), { recursive: true });
  await writeFile(join(root, path), text);
};
const front = (status: string, body = "# T\n") => `---\nstatus: ${status}\n---\n${body}`;

describe("knowledge-list: the library of a project, read only (#76)", () => {
  test("lists the markdown of the library folders by path, and nothing else", async () => {
    const root = tempDir("fd-knowledge-");
    await put(root, "docs/adr/0002-b.md", front("valid", "# Second\n"));
    await put(root, "docs/adr/0001-a.md", front("obsolete", "# First\n"));
    await put(root, "docs/decisions/2026-01-01-x.md", "# Old decision (issue #3)\n");
    await put(root, "docs/other/ignored.md", front("valid"));
    await put(root, "README.md", front("valid"));
    await put(root, "docs/adr/notes.txt", "not markdown");
    await put(root, "docs/adr/node_modules/pkg/readme.md", front("valid"));
    const { entries, truncated } = await listKnowledge(root);
    expect([entries.map((e) => [e.path, e.title, e.status]), truncated]).toEqual([
      [
        ["docs/adr/0001-a.md", "First", "obsolete"],
        ["docs/adr/0002-b.md", "Second", "valid"],
        ["docs/decisions/2026-01-01-x.md", "Old decision", "unclassified"],
      ],
      false,
    ]);
  });

  test("a project with no library folder has an empty list", async () => {
    expect(await listKnowledge(tempDir("fd-knowledge-"))).toEqual({
      entries: [],
      truncated: false,
    });
  });

  test("a link, a credential name and a folder that is a link are left out", async () => {
    const root = tempDir("fd-knowledge-");
    const outside = tempDir("fd-knowledge-out-");
    await put(outside, "secret.md", front("valid"));
    await put(root, "docs/adr/ok.md", front("valid"));
    await mkdir(join(root, "docs/rfc"), { recursive: true });
    await symlink(join(outside, "secret.md"), join(root, "docs/adr/link.md"));
    await symlink(outside, join(root, "docs/rfc/inside"));
    await put(root, "docs/adr/.env.md", front("valid"));
    const { entries } = await listKnowledge(root);
    expect(entries.map((e) => e.path)).toEqual(["docs/adr/ok.md"]);
  });

  test("a docs folder that is a link to somewhere outside is not walked", async () => {
    const root = tempDir("fd-knowledge-");
    const outside = tempDir("fd-knowledge-out-");
    await put(outside, "adr/outside.md", front("valid", "# Outside\n"));
    await symlink(outside, join(root, "docs"));
    expect((await listKnowledge(root)).entries.map((e) => e.path)).toEqual([]);
  });

  test("a hard link to a file elsewhere is left out, and a plain document beside it stays", async () => {
    const root = tempDir("fd-knowledge-");
    await put(root, "private/notes.md", "# Private note\n");
    await put(root, "docs/adr/ok.md", front("valid"));
    await link(join(root, "private/notes.md"), join(root, "docs/adr/hard.md"));
    expect((await listKnowledge(root)).entries.map((e) => e.path)).toEqual(["docs/adr/ok.md"]);
  });

  test("more documents than the cap are cut and the list says so", async () => {
    const root = tempDir("fd-knowledge-");
    for (const n of [1, 2, 3, 4, 5]) await put(root, `docs/adr/${n}.md`, front("valid"));
    const { entries, truncated } = await listKnowledge(root, { maxFiles: 3 });
    expect([entries.map((e) => e.path), truncated]).toEqual([
      ["docs/adr/1.md", "docs/adr/2.md", "docs/adr/3.md"],
      true,
    ]);
  });

  test("a large document is read from its start only, and its size is its real size", async () => {
    const root = tempDir("fd-knowledge-");
    await put(root, "docs/adr/big.md", `${front("valid", "# Big\n")}${"x".repeat(100_000)}\n`);
    const { entries } = await listKnowledge(root);
    expect([entries[0]?.title, entries[0]?.status, (entries[0]?.bytes ?? 0) > 100_000]).toEqual([
      "Big",
      "valid",
      true,
    ]);
  });

  test("a valid document that links to an obsolete one is warned about, and a missing supersedes is a problem", async () => {
    const root = tempDir("fd-knowledge-");
    await put(root, "docs/adr/old.md", front("obsolete"));
    await put(
      root,
      "docs/adr/new.md",
      "---\nstatus: valid\nsupersedes: docs/adr/gone.md\n---\n# New\n\nSee [the old one](./old.md) and [the web](https://example.test/x.md).\n",
    );
    await put(root, "docs/adr/other.md", front("obsolete", "# Other\nSee [old](old.md)\n"));
    const { entries } = await listKnowledge(root);
    const by = (path: string) => entries.find((e) => e.path === path);
    expect([
      by("docs/adr/new.md")?.warnings,
      by("docs/adr/new.md")?.problems,
      by("docs/adr/other.md")?.warnings,
    ]).toEqual([["references_obsolete:docs/adr/old.md"], ["supersedes_missing"], []]);
  });
});

describe("knowledge-list: over the protocol (#76)", () => {
  test("the host announces knowledge and answers knowledge.list for a project inside the allowed roots", async () => {
    const ctx = newManager();
    await put(ctx.project, "docs/adr/a.md", front("valid", "# Served\n"));
    const server = startServer({
      manager: ctx.manager,
      knowledge: (path) => listKnowledge(path),
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [ctx.root],
    });
    cleanups.push(() => server.stop());
    const client = new FrameClient(server.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    const info = await client.data<{ features?: string[] }>("host.info", {});
    const served = await client.data<{ entries: Array<{ title: string }> }>("knowledge.list", {
      path: ctx.project,
    });
    const outside = await client.request("knowledge.list", { path: tempDir("fd-knowledge-out-") });
    expect([
      info?.features?.includes("knowledge") ?? false,
      served?.entries.map((e) => e.title) ?? null,
      outside.ok,
    ]).toEqual([true, ["Served"], false]);
  });
});
