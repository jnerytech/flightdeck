import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { runCli } from "../../src/main.ts";
import { git, gitRepo } from "../support/board-helpers.ts";
import { tempDir } from "../support/helpers.ts";
import { FrameClient } from "../support/history-helpers.ts";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

describe("snapshots: the started daemon", () => {
  test("flightdeckd start: a sessão gerenciada num repositório gera snapshots, listados por snapshots.list", async () => {
    const { repo } = gitRepo();
    const dir = tempDir();
    const file = join(dir, "config.json");
    const token = "snapshots-token-0123456789abc";
    writeFileSync(
      file,
      JSON.stringify({
        port: 0,
        token,
        dataDir: join(dir, "data"),
        hooks: { port: 0 },
        allowedRoots: [dirname(repo)],
      }),
    );
    const daemon = await runCli(["--config", file, "--runtime", "fake"], {
      env: {},
      log: { log: () => {}, error: () => {} },
      exit: () => {},
      onSignal: () => {},
    });
    cleanups.push(() => daemon?.stop());
    const client = new FrameClient(daemon?.url ?? "");
    cleanups.push(() => client.close());
    await client.request("hello", { token, client: "t" });
    writeFileSync(join(repo, "a.txt"), "antes do turno\n");
    const created = await client.data<{ sessionId: string }>("session.create", {
      cwd: repo,
      prompt: "um turno",
    });
    let claudeSessionId: string | null = null;
    let rows: Array<{ kind: string }> = [];
    const deadline = Date.now() + 5000;
    while (rows.length < 2 && Date.now() < deadline) {
      const { sessions } = (await client.data<{
        sessions: Array<{ id: string; claudeSessionId: string | null }>;
      }>("session.list", {})) ?? { sessions: [] };
      claudeSessionId = sessions.find((s) => s.id === created?.sessionId)?.claudeSessionId ?? null;
      if (claudeSessionId) {
        rows =
          (
            await client.data<{ snapshots: Array<{ kind: string }> }>("snapshots.list", {
              claudeSessionId,
            })
          )?.snapshots ?? [];
      }
      if (rows.length < 2) await Bun.sleep(50);
    }
    expect(rows.map((r) => r.kind)).toEqual(["before", "after"]);
    expect(git(repo, "status", "--porcelain")).toBe("?? a.txt");
  }, 20_000);
});
