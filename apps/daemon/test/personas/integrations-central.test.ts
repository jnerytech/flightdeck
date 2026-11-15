import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ExternalSessions } from "../../src/central/external.ts";
import { sendSessionStart } from "../../src/central/hook-command.ts";
import { runCli } from "../../src/main.ts";
import { packPersonas } from "../../src/personas/pack.ts";
import { Personas } from "../../src/personas/store.ts";
import { startServer } from "../../src/server.ts";
import { EventStore } from "../../src/store/event-store.ts";
import { installFakeClaude } from "../support/fake-claude.ts";
import { newManager, tempDir, workspace } from "../support/helpers.ts";
import { FrameClient } from "../support/history-helpers.ts";
import { cleanups, runCleanups, scanner } from "../support/personas-integrations.ts";

// Real git in temp repositories and several turns per test: more than the default 5 s.
setDefaultTimeout(30_000);

const TOKEN = "personas-int-token-0123456789abcdef";

afterEach(runCleanups);

describe("personas-integracoes: na central", () => {
  test("o hook SessionStart leva a persona com que o terminal abriu, e a sessão mostra o selo", async () => {
    const badge = { id: "qa", name: "QA / testes", icon: "flask" };
    const bodies: unknown[] = [];
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req) {
        bodies.push(await req.json());
        return new Response("");
      },
    });
    cleanups.push(() => server.stop(true));
    await sendSessionStart({
      url: `http://127.0.0.1:${server.port}`,
      token: "t",
      input: JSON.stringify({ session_id: "claude-9" }),
      env: { FLIGHTDECK_LAUNCH_ID: "L9", FLIGHTDECK_PERSONA: JSON.stringify(badge) },
      timeoutMs: 2000,
    });
    expect(bodies[0]).toMatchObject({ session_id: "claude-9", launch_id: "L9", persona: badge });
    // Junk in the variable is not forwarded.
    await sendSessionStart({
      url: `http://127.0.0.1:${server.port}`,
      token: "t",
      input: JSON.stringify({ session_id: "claude-10" }),
      env: { FLIGHTDECK_PERSONA: "isto não é json" },
      timeoutMs: 2000,
    });
    expect(bodies[1]).not.toHaveProperty("persona");

    const external = new ExternalSessions({ db: new EventStore(":memory:").db, staleAfterS: 900 });
    external.apply("SessionStart", bodies[0] as Record<string, unknown>);
    expect(external.get("claude-9")?.persona).toEqual(badge);
    // Applied on top, and back to the one it opened with after leaving.
    external.setPersona("claude-9", { id: "seg", name: "Segurança", icon: null });
    expect(external.get("claude-9")?.persona).toMatchObject({ id: "seg" });
    external.setPersona("claude-9", null);
    expect(external.get("claude-9")?.persona).toEqual(badge);
    // A badge that is not one is ignored.
    external.apply("SessionStart", { session_id: "claude-11", persona: { id: 3 } });
    expect(external.get("claude-11")?.persona).toBeUndefined();
  });

  test("flightdeckd claude --persona avisa o claude: FLIGHTDECK_PERSONA leva o selo da persona", async () => {
    const { root, project } = workspace();
    const personas = new Personas({
      db: new EventStore(":memory:").db,
      allowedRoots: [root],
      scanner,
      pack: packPersonas,
    });
    const dir = tempDir();
    const dataDir = join(dir, "data");
    mkdirSync(dataDir, { recursive: true });
    const server = startServer({
      manager: newManager().manager,
      personas: { store: personas },
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: "t".repeat(32),
      allowedRoots: [root],
    });
    cleanups.push(() => server.stop());
    const file = join(dir, "config.json");
    writeFileSync(
      file,
      JSON.stringify({
        token: "t".repeat(32),
        port: server.port,
        dataDir,
        hooks: { port: 0, token: "hooks-token-0123456789" },
      }),
    );
    const fake = installFakeClaude([{ do: "exit", code: 0 }]);
    cleanups.push(fake.restore);
    await runCli(["claude", "--persona", "qa"], {
      env: { ...process.env, FLIGHTDECK_CONFIG: file },
      log: { log: () => {}, error: () => {} },
      exit: () => {},
      onSignal: () => {},
      selfCommand: [process.execPath, "run", join(import.meta.dir, "../../src/bin.ts")],
      cwd: project,
    });
    const start = fake.events().find((e) => e.type === "start") as unknown as {
      env: Record<string, string>;
    };
    expect(JSON.parse(start.env.FLIGHTDECK_PERSONA ?? "null")).toEqual({
      id: "qa",
      name: "QA / testes",
      icon: "flask",
    });
  });

  test("as listas de sessões trazem o selo, para a central filtrar por persona", async () => {
    const { root, project, store, personas } = (() => {
      const w = workspace();
      const s = new EventStore(":memory:");
      return {
        ...w,
        store: s,
        personas: new Personas({ db: s.db, allowedRoots: [w.root], scanner, pack: packPersonas }),
      };
    })();
    const { manager, start } = newManager({ store, allowedRoots: [root], personas });
    cleanups.push(() => manager.shutdown());
    await start({ cwd: project, prompt: "oi", persona: { id: "dba" } });
    await start({ cwd: project, prompt: "oi" });
    const server = startServer({
      manager,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [root],
    });
    cleanups.push(() => server.stop());
    const client = new FrameClient(server.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    const listed = await client.data<{ sessions: Array<{ persona?: { id: string } }> }>(
      "session.list",
      {},
    );
    expect(listed?.sessions.map((s) => s.persona?.id ?? "-").sort()).toEqual(["-", "dba"]);
  });
});
