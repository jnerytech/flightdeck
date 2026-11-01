import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";
import { runCli } from "../src/main.ts";
import { tempDir } from "./helpers.ts";
import {
  assistantLine,
  FrameClient,
  projectsRoot,
  userLine,
  writeTranscript,
} from "./history-helpers.ts";

setDefaultTimeout(30_000);

const TOKEN = "vigiar-historico-token-0123456789abcdef";
const PR = "https://dev.azure.com/acme/proj/_git/repo/pullrequest/9";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

describe("vigiar-historico: a PR link that belongs to no card finds the sessions that named it", () => {
  test("watch.byUrl answers with the old sessions whose history mentions the link, one entry per session", async () => {
    const projects = projectsRoot();
    const cwd = "/work/repo";
    writeTranscript(projects, "-work-repo", "sess-1", [
      userLine({ uuid: "u1", text: `please review ${PR}`, cwd }),
      assistantLine({ uuid: "a1", text: `I looked at ${PR} and it is fine`, cwd }),
    ]);
    writeTranscript(projects, "-work-other", "sess-2", [
      userLine({ uuid: "u2", text: "something else entirely", cwd: "/work/other" }),
    ]);
    const dir = tempDir("fd-vigiar-hist-");
    const file = join(dir, "config.json");
    await Bun.write(
      file,
      JSON.stringify({
        port: 0,
        token: TOKEN,
        dataDir: join(dir, "data"),
        hooks: { port: 0 },
        allowedRoots: [dir],
        history: { roots: [projects], scanIntervalMs: 50 },
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
    await client.request("hello", { token: TOKEN, client: "t" });
    let found: { via: string; sessions: Array<{ claudeSessionId: string; cwd: string }> } | null =
      null;
    for (let i = 0; i < 100 && found?.via !== "history"; i++) {
      found = await client.data("watch.byUrl", { url: `${PR}?_a=overview` });
      if (found?.via !== "history") await Bun.sleep(50);
    }
    expect(found?.via).toBe("history");
    expect(found?.sessions).toEqual([expect.objectContaining({ claudeSessionId: "sess-1", cwd })]);
  });
});
