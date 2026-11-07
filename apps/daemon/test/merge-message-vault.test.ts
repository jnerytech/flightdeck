import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { startDaemon } from "../src/main.ts";
import { gitRepo } from "./board-helpers.ts";
import { FrameClient } from "./history-helpers.ts";

setDefaultTimeout(30_000);
const TOKEN = "Zk3fakeprotocoltoken0123456789abcdefghijklmnop";
// Bare and prefix-less, as a real held secret is: no token pattern knows its shape.
const VAULT_VALUE = "Vx9fakevaultvalue0123456789";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

describe("merge-message-vault: the board scans for what the vault holds (issue #681)", () => {
  test("a value the vault holds, typed as the merge message or the PR title, is refused", async () => {
    const { root, repo } = gitRepo();
    const file = join(root, "config.json");
    writeFileSync(
      file,
      JSON.stringify({
        hostName: "h",
        port: 0,
        token: TOKEN,
        hooks: { token: "Qw8fakehookstoken0123456789abcdefghijklmnop", port: 0 },
        dataDir: join(root, "data"),
        allowedRoots: [root],
      }),
    );
    const daemon = await startDaemon(
      { command: "start", config: file, runtime: "fake" },
      {},
      { log: () => {}, error: () => {} },
      { logDir: join(root, "logs"), configWatchMs: 20 },
    );
    cleanups.push(() => daemon.stop());
    const client = new FrameClient(daemon.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    const project = (await client.data<{ id: string }>("project.add", { path: repo })) as {
      id: string;
    };
    const card = (await client.data<{ id: string }>("card.create", {
      projectId: project.id,
      title: "Integrar",
      description: "oi",
    })) as { id: string };
    await client.request("vault.deliver", {
      secretId: "s1",
      value: VAULT_VALUE,
      purpose: "p",
      expiresAt: Date.now() + 30_000,
      requester: "claude",
    });
    const reason = (ack: Record<string, unknown>) =>
      (ack.error as { reason?: string } | undefined)?.reason ?? "no reason";
    const merge = await client.request("card.mergeLocal", {
      cardId: card.id,
      mode: "squash",
      confirm: true,
      message: `Fix with ${VAULT_VALUE}`,
    });
    expect(reason(merge)).toBe("merge_message_secret");
    const pr = await client.request("card.pr.create", {
      cardId: card.id,
      title: `Fix with ${VAULT_VALUE}`,
    });
    expect(reason(pr)).toBe("pr_title_secret");
  });
});
