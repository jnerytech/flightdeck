import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { ExternalSessions } from "../src/central/external.ts";
import { hookEntries } from "../src/central/hooks-install.ts";
import { startReceptor } from "../src/central/receptor.ts";
import { runCli } from "../src/main.ts";
import { daemonCommand } from "../src/service.ts";
import { EventStore } from "../src/store/event-store.ts";
import { poll } from "./helpers.ts";
import { runHookCommand } from "./hook-shell.ts";

const TOKEN = "hooks-token-0123456789";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

function receptor() {
  const store = new EventStore(":memory:");
  const external = new ExternalSessions({ db: store.db, staleAfterS: 900 });
  const server = startReceptor({ port: 0, token: () => TOKEN, external, isManaged: () => false });
  cleanups.push(() => server.stop());
  return { external, url: server.url };
}

const START = {
  session_id: "s1",
  transcript_path: "/p/s1.jsonl",
  cwd: "/p",
  hook_event_name: "SessionStart",
  source: "startup",
};

/** Runs `flightdeckd hook session-start` in process, with the hook's JSON on stdin. */
async function hook(
  url: string,
  input: string,
  env: Record<string, string> = {},
  extra: { token?: string; hookConnectTimeoutMs?: number } = {},
) {
  const out: string[] = [];
  let code = null as number | null;
  await runCli(["hook", "session-start", "--url", url, "--token", extra.token ?? TOKEN], {
    env,
    log: { log: (m) => out.push(m), error: (m) => out.push(m) },
    exit: (c) => {
      code = c;
    },
    onSignal: () => {},
    stdin: new Blob([input]).stream(),
    ...(extra.hookConnectTimeoutMs ? { hookConnectTimeoutMs: extra.hookConnectTimeoutMs } : {}),
  });
  return { code, out };
}

describe("hook-comando", () => {
  test("repassa a entrada e o launch id ao receptor, sem saída", async () => {
    const { external, url } = receptor();
    const result = await hook(url, JSON.stringify(START), { FLIGHTDECK_LAUNCH_ID: "L1" });
    expect(result).toEqual({ code: 0, out: [] });
    expect(external.get("s1")).toMatchObject({
      status: "idle",
      cwd: "/p",
      transcriptPath: "/p/s1.jsonl",
      source: "startup",
      launchId: "L1",
    });
  });

  test("sem launch id, a sessão fica sem; com FLIGHTDECK_MANAGED=1, o receptor a ignora", async () => {
    const { external, url } = receptor();
    await hook(url, JSON.stringify(START));
    expect(external.get("s1")?.launchId).toBeNull();
    await hook(url, JSON.stringify({ ...START, session_id: "s2" }), { FLIGHTDECK_MANAGED: "1" });
    expect(external.get("s2")).toBeNull();
  });

  test("receptor fora do ar ou travado: sai com 0, sem saída e sem esperar o timeout do hook", async () => {
    const closed = Bun.serve({ port: 0, fetch: () => new Response("") });
    const closedUrl = `http://127.0.0.1:${closed.port}`;
    await closed.stop(true);
    expect(await hook(closedUrl, JSON.stringify(START), {}, { hookConnectTimeoutMs: 100 })).toEqual(
      { code: 0, out: [] },
    );
    // Accepts the connection and never answers.
    const stuck = Bun.serve({ port: 0, fetch: () => new Promise<Response>(() => {}) });
    cleanups.push(() => stuck.stop(true));
    const started = performance.now();
    const result = await hook(
      `http://127.0.0.1:${stuck.port}`,
      JSON.stringify(START),
      {},
      { hookConnectTimeoutMs: 100 },
    );
    expect(result).toEqual({ code: 0, out: [] });
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  test("entrada inválida ou token errado também saem com 0 em silêncio", async () => {
    const { external, url } = receptor();
    expect(await hook(url, "não é json")).toEqual({ code: 0, out: [] });
    expect(await hook(url, JSON.stringify(START), {}, { token: "errado" })).toEqual({
      code: 0,
      out: [],
    });
    expect(external.list()).toEqual([]);
  });

  test("a linha gravada pelo install roda no shell do Claude Code e chega ao receptor", async () => {
    const { external, url } = receptor();
    // What install writes for this daemon (`bun run <bin.ts>` in development).
    const self = daemonCommand(process.execPath, join(import.meta.dir, "..", "src", "bin.ts"));
    const line =
      hookEntries({ command: self, url, token: TOKEN, permissionTimeoutS: 600 }).SessionStart?.[0]
        ?.hooks[0]?.command ?? "";
    const result = runHookCommand(line, JSON.stringify(START), { FLIGHTDECK_LAUNCH_ID: "L9" });
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(await poll(() => external.get("s1")?.launchId)).toBe("L9");
  });

  test("evento de hook desconhecido é recusado pelo CLI", async () => {
    const out: string[] = [];
    let code = null as number | null;
    await runCli(["hook", "pre-tool-use"], {
      env: {},
      log: { log: (m) => out.push(m), error: (m) => out.push(m) },
      exit: (c) => {
        code = c;
      },
      onSignal: () => {},
    });
    expect(code).toBe(1);
    expect(out.join("\n")).toContain("hook inválido: pre-tool-use");
  });
});
