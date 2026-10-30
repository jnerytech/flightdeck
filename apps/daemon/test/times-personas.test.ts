import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";
import { runCli } from "../src/main.ts";
import { gitRepo } from "./board-helpers.ts";
import { tempDir } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

setDefaultTimeout(40_000);

const TOKEN = "times-personas-token-0123456789abcdef";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function until<T>(
  check: () => Promise<T | null | undefined>,
  ms = 20_000,
): Promise<T | null> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await Bun.sleep(100);
  }
  return null;
}

describe("times: the personas of phase 20 reach the team's sessions", () => {
  test("the daemon built by main opens the coordinator and each worker in the persona the team gives them", async () => {
    const { root, repo } = gitRepo();
    const dir = tempDir("fd-times-personas-");
    const file = join(dir, "config.json");
    await Bun.write(
      file,
      JSON.stringify({
        port: 0,
        token: TOKEN,
        dataDir: join(dir, "data"),
        hooks: { port: 0 },
        allowedRoots: [root],
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
    const project = await client.data<{ id: string }>("project.add", { path: repo });
    const team = await client.data<{ id: string }>("teams.create", {
      projectId: project?.id,
      goal: "revisar o login",
      workers: 1,
      coordinatorPersona: "revisor",
      workerPersonas: ["qa"],
    });
    expect(team?.id).toBeTruthy();
    type Listed = { sessions: Array<{ name: string | null; persona?: { id: string } | null }> };
    const personaOf = (suffix: string) =>
      until(async () => {
        const listed = await client.data<Listed>("session.list", {});
        return listed?.sessions.find((s) => s.name?.endsWith(suffix))?.persona?.id;
      });
    expect(await personaOf("coordenadora")).toBe("revisor");
    expect(await personaOf("executora 1")).toBe("qa");
  });
});
