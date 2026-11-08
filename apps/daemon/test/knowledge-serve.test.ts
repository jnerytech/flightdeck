import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { KnowledgeIndexResult } from "@flightdeck/protocol";
import { knowledgeFeedFor } from "../src/knowledge/serve.ts";
import { startServer } from "../src/server.ts";
import { newManager, tempDir } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

/** Issue #76: what a session is given of the library: trusted, not switched off, from the trusted checkout. */
const TOKEN = "knowledge-serve-token-0123456789";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const put = async (root: string, path: string, text: string) => {
  await mkdir(join(root, path, ".."), { recursive: true });
  await writeFile(join(root, path), text);
};
const front = (status: string, body = "# T\n") => `---\nstatus: ${status}\n---\n${body}`;
const trusted = async () => ({ trusted: true });

describe("knowledge-serve: who is given the index (#76)", () => {
  test("a trusted project gives its valid and transitional documents, and not the others", async () => {
    const root = tempDir("fd-feed-");
    await put(root, "docs/adr/0001-a.md", front("valid", "# Use SQLite\n"));
    await put(root, "docs/adr/0002-b.md", front("transitional", "# Move to Postgres\n"));
    await put(root, "docs/adr/0003-c.md", front("obsolete", "# Old plan\n"));
    await put(root, "docs/adr/0004-d.md", "# No status\n");
    const feed = await knowledgeFeedFor({ off: () => [], trust: trusted })(root);
    expect(feed.text).toContain("- docs/adr/0001-a.md: Use SQLite\n");
    expect(feed.text).toContain("- docs/adr/0002-b.md: Move to Postgres (transitional)\n");
    expect(feed.text).not.toContain("0003-c");
    expect(feed.text).not.toContain("0004-d");
    expect([feed.fed, feed.truncated]).toEqual([2, false]);
  });

  test("a project that is not trusted is given nothing, whatever its documents say", async () => {
    const root = tempDir("fd-feed-");
    await put(root, "docs/adr/0001-a.md", front("valid"));
    const feed = await knowledgeFeedFor({
      off: () => [],
      trust: async () => ({ trusted: false }),
    })(root);
    expect(feed).toEqual({ text: "", fed: 0, truncated: false });
  });

  test("a project switched off is given nothing: by its own folder, or by a folder above it", async () => {
    const parent = tempDir("fd-feed-");
    const root = join(parent, "app");
    await put(root, "docs/adr/0001-a.md", front("valid"));
    const feedFor = (off: string[]) => knowledgeFeedFor({ off: () => off, trust: trusted });
    const own = await feedFor([root])(root);
    const above = await feedFor([parent])(root);
    // `app2` shares its name's start with `app`, and is another folder.
    const sibling = await feedFor([join(parent, "app2")])(root);
    expect([own.fed, above.fed, sibling.fed]).toEqual([0, 0, 1]);
  });

  test("a worktree is read from the trusted checkout it belongs to, never from the branch", async () => {
    const main = tempDir("fd-feed-main-");
    const branch = tempDir("fd-feed-branch-");
    await put(main, "docs/adr/0001-main.md", front("valid", "# From main\n"));
    await put(branch, "docs/adr/0002-branch.md", front("valid", "# From the branch\n"));
    const feed = await knowledgeFeedFor({
      off: () => [],
      trust: async () => ({ trusted: true, configRoot: main }),
    })(branch);
    expect(feed.text).toContain("From main");
    expect(feed.text).not.toContain("From the branch");
  });

  test("a project with no library is given nothing", async () => {
    const feed = await knowledgeFeedFor({ off: () => [], trust: trusted })(tempDir("fd-feed-"));
    expect(feed).toEqual({ text: "", fed: 0, truncated: false });
  });
});

describe("knowledge-serve: over the protocol (#76)", () => {
  const start = (knowledgeFeed?: (path: string) => Promise<KnowledgeIndexResult>) => {
    const ctx = newManager();
    const server = startServer({
      manager: ctx.manager,
      ...(knowledgeFeed ? { knowledgeFeed } : {}),
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [ctx.root],
    });
    cleanups.push(() => server.stop());
    return { ctx, server };
  };

  test("knowledge.index answers for a project inside the allowed roots, and refuses another folder", async () => {
    const { ctx, server } = start(async () => ({ text: "index", fed: 1, truncated: false }));
    const client = new FrameClient(server.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    const served = await client.data<{ text: string }>("knowledge.index", { path: ctx.project });
    const outside = await client.request("knowledge.index", { path: tempDir("fd-feed-out-") });
    expect([served?.text, outside.ok]).toEqual(["index", false]);
  });

  test("a host without it refuses knowledge.index", async () => {
    const { ctx, server } = start();
    const client = new FrameClient(server.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    const refused = await client.request("knowledge.index", { path: ctx.project });
    expect(refused.ok).toBe(false);
  });
});
