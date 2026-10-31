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
    // A persona the host does not know is refused; taking one away clears the session's.
    expect(
      await client.request("teams.create", {
        projectId: project?.id,
        goal: "com uma persona que não existe",
        workers: 1,
        coordinatorPersona: "nao-existe",
      }),
    ).toMatchObject({ ok: false, error: { message: "a persona nao-existe não existe" } });
    type Teams = {
      teams: Array<{ id: string; members: Array<{ name: string; persona: string | null }> }>;
    };
    const coordinatorOf = async () =>
      (await client.data<Teams>("teams.list", {}))?.teams
        .find((t) => t.id === team?.id)
        ?.members.find((m) => m.name.endsWith("coordenadora"));
    const updated = await client.request("teams.update", {
      team: team?.id,
      persona: { member: (await coordinatorOf())?.name, persona: null },
    });
    expect(updated).toMatchObject({ ok: true });
    expect((await coordinatorOf())?.persona).toBeNull();
    // Without one, the coordinator is the pack's coordenador.
    await client.data("teams.create", {
      projectId: project?.id,
      name: "segundo",
      goal: "outro objetivo",
      workers: 1,
    });
    const coordinator = await until(async () => {
      const listed = await client.data<Listed>("session.list", {});
      return listed?.sessions.find((s) => s.name === "segundo · coordenadora")?.persona?.id;
    });
    expect(coordinator).toBe("coordenador");
    // The worker's card is still starting: wait for it, so the daemon does not stop under it.
    await until(async () => {
      const listed = await client.data<Listed>("session.list", {});
      return listed?.sessions.find((s) => s.name === "segundo · executora 1");
    });
  });
});
