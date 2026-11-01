import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { startDaemon } from "../src/main.ts";
import { gitRepo } from "./board-helpers.ts";
import { installFakeClaude } from "./fake-claude.ts";
import { tempDir } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

setDefaultTimeout(30_000);
const TOKEN = "bg-card-token-0123456789abcdef0123";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

describe("bg-iniciar: the daemon resolves a card", () => {
  test("bg.start with a card asks the board for its folder and text, and a card that is not there is not_found", async () => {
    const fake = installFakeClaude([]);
    cleanups.push(fake.restore);
    const { root, repo } = gitRepo();
    const dir = tempDir();
    const file = join(dir, "config.json");
    writeFileSync(
      file,
      JSON.stringify({ port: 0, token: TOKEN, dataDir: join(dir, "data"), allowedRoots: [root] }),
    );
    const daemon = await startDaemon(
      { command: "start", config: file, runtime: "fake" },
      {},
      { log: () => {}, error: () => {} },
    );
    cleanups.push(() => daemon.stop());
    const client = new FrameClient(daemon.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    const project = await client.data<{ id: string }>("project.add", { path: repo });
    const card = await client.data<{ id: string }>("card.create", {
      projectId: project?.id,
      title: "Somar o total",
      description: "O total erra.",
    });
    // The wrapper cannot run from a test (the daemon's own command line is the test runner's), so
    // the start is refused by the CLI: what matters is that the card was resolved first.
    const started = (await client.request("bg.start", { cardId: card?.id })) as {
      ok: boolean;
      error?: { code?: string; reason?: string };
    };
    expect(started.ok).toBe(false);
    expect(started.error?.reason).toBe("bg_cli_failed");
    const missing = (await client.request("bg.start", { cardId: "nope" })) as {
      error?: { code?: string };
    };
    expect(missing.error?.code).toBe("not_found");
  });
});
