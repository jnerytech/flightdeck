import { describe, expect, test } from "bun:test";
import { isPreviewUrl } from "@flightdeck/protocol";
import { RunManager } from "../src/runenv/manager.ts";
import { CardPorts } from "../src/runenv/ports.ts";
import { httpReady, type ReadyResult, waitForServer, waitReady } from "../src/runenv/preview.ts";
import { EventStore } from "../src/store/event-store.ts";
import { poll } from "./helpers.ts";
import { fakeRunHost, runConfig } from "./run-helpers.ts";

describe("preview: só loopback", () => {
  test("http e https em 127.0.0.1 e localhost abrem, com ou sem porta, caminho e consulta", () => {
    for (const url of [
      "http://127.0.0.1/",
      "http://127.0.0.1:41000/",
      "https://127.0.0.1:41000/app?x=1#topo",
      "http://localhost:3000",
      "HTTP://LOCALHOST:3000/",
    ]) {
      expect(isPreviewUrl(url)).toBe(true);
    }
  });

  test("qualquer outro endereço é recusado: outro host, outra interface, outro protocolo, lixo", () => {
    for (const url of [
      "http://example.com/",
      "http://0.0.0.0:3000/",
      "http://127.0.0.2/",
      "http://[::1]:3000/",
      "http://localhost.evil.com/",
      "http://127.0.0.1.evil.com/",
      "http://127.0.0.1@evil.com/",
      "ftp://127.0.0.1/",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "127.0.0.1:3000",
      "",
    ]) {
      expect(isPreviewUrl(url)).toBe(false);
    }
  });
});

describe("preview: espera o ready", () => {
  /** A clock the waits move: `sleep` advances it, no real time passes. */
  function clock() {
    let now = 0;
    const slept: number[] = [];
    return {
      now: () => now,
      sleep: async (ms: number) => {
        slept.push(ms);
        now += ms;
      },
      slept,
    };
  }

  test("sonda de tempos em tempos até responder, e então diz ready", async () => {
    const c = clock();
    const answers = [false, false, true];
    const asked: string[] = [];
    const result = await waitReady("http://127.0.0.1:41000/", {
      probe: async (url) => {
        asked.push(url);
        return answers.shift() ?? false;
      },
      timeoutMs: 10_000,
      intervalMs: 500,
      sleep: c.sleep,
      now: c.now,
    });
    expect(result).toBe("ready");
    expect(asked).toEqual(Array(3).fill("http://127.0.0.1:41000/"));
    expect(c.slept).toEqual([500, 500]);
  });

  test("passou o prazo sem responder: timeout", async () => {
    const c = clock();
    const result = await waitReady("http://127.0.0.1:41000/", {
      probe: async () => false,
      timeoutMs: 2000,
      intervalMs: 500,
      sleep: c.sleep,
      now: c.now,
    });
    expect(result).toBe("timeout");
    expect(c.now()).toBeGreaterThanOrEqual(2000);
  });

  test("o Run parado interrompe a espera, antes da primeira sonda ou no meio", async () => {
    const c = clock();
    let stopped = true;
    const probes: number[] = [];
    const options = {
      probe: async () => {
        probes.push(1);
        return false;
      },
      timeoutMs: 10_000,
      intervalMs: 500,
      sleep: async (ms: number) => {
        await c.sleep(ms);
        stopped = true;
      },
      now: c.now,
      stopped: () => stopped,
    };
    expect(await waitReady("http://127.0.0.1:1/", options)).toBe("stopped");
    expect(probes).toEqual([]);
    stopped = false;
    expect(await waitReady("http://127.0.0.1:1/", options)).toBe("stopped");
    expect(probes).toEqual([1]);
  });

  test("a sonda real: qualquer resposta HTTP conta, até um 404; ninguém ouvindo, não", async () => {
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Response("não achei", { status: 404 }),
    });
    const url = `http://127.0.0.1:${server.port}/`;
    expect(await httpReady(url)).toBe(true);
    await server.stop(true);
    expect(await httpReady(url)).toBe(false);
  });
});

describe("preview: a espera de verdade", () => {
  test("um servidor no ar é ready logo, e um Run parado nem sonda", async () => {
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("ok") });
    const url = `http://127.0.0.1:${server.port}/`;
    expect(await waitForServer(url, () => false)).toBe("ready");
    expect(await waitForServer(url, () => true)).toBe("stopped");
    await server.stop(true);
  });
});

/** A manager whose ready waits the test settles by hand. */
function managed() {
  const fake = fakeRunHost();
  const store = new EventStore(":memory:");
  const waits: Array<{
    url: string;
    stopped: () => boolean;
    settle: (result: ReadyResult) => void;
  }> = [];
  const config = runConfig({
    setup: null,
    run: [
      {
        name: "web",
        cmd: ["serve", "--port", "{{port.web}}"],
        env: {},
        ready: { http: "http://127.0.0.1:{{port.web}}/" },
      },
      { name: "api", cmd: ["api"], env: {}, ready: null },
    ],
  });
  const manager = new RunManager({
    db: store.db,
    configs: { resolve: async () => config },
    ports: new CardPorts({ db: store.db, isFree: async () => true }),
    host: fake.host,
    card: (id) => ({ id, projectId: "proj", worktreePath: `/work/${id}` }),
    project: (id) => ({ id, path: "/repo", baseBranch: "main" }),
    waitReady: (url, stopped) =>
      new Promise((resolve) => {
        waits.push({ url, stopped, settle: resolve });
      }),
  });
  return { manager, waits, ...fake };
}

const processes = (m: ReturnType<typeof managed>) =>
  m.manager.state("card-a").processes.map((p) => [p.name, p.url, p.ready]);

describe("preview: o estado dos processos", () => {
  test("com ready.http, o processo mostra o endereço com a porta e fica esperando; sem, não tem preview", async () => {
    const m = managed();
    await m.manager.start("card-a");
    expect(processes(m)).toEqual([
      ["web", "http://127.0.0.1:41000/", "waiting"],
      ["api", null, "none"],
    ]);
    expect(m.waits.map((w) => w.url)).toEqual(["http://127.0.0.1:41000/"]);
  });

  test("quando responde, o processo fica ready e quem acompanha é avisado; no prazo vencido, timeout", async () => {
    const m = managed();
    const heard: string[] = [];
    m.manager.watch((state) => heard.push(state.processes[0]?.ready ?? ""));
    await m.manager.start("card-a");
    m.waits[0]?.settle("ready");
    await poll(() => processes(m)[0]?.[2] === "ready", 400);
    expect(processes(m)[0]).toEqual(["web", "http://127.0.0.1:41000/", "ready"]);
    expect(heard).toContain("ready");
    await m.manager.stop("card-a");
    await m.manager.start("card-a");
    m.waits[1]?.settle("timeout");
    await poll(() => processes(m)[0]?.[2] === "timeout", 400);
    expect(processes(m)[0]?.[2]).toBe("timeout");
  });

  test("o processo que acaba deixa de ser preview, e o Stop interrompe a espera", async () => {
    const m = managed();
    await m.manager.start("card-a");
    const wait = m.waits[0];
    expect(wait?.stopped()).toBe(false);
    await m.manager.stop("card-a");
    expect(wait?.stopped()).toBe(true);
    expect(processes(m)[0]).toEqual(["web", "http://127.0.0.1:41000/", "none"]);
    wait?.settle("stopped");
    await Bun.sleep(5);
    expect(processes(m)[0]?.[2]).toBe("none");
  });

  test("um servidor que cai depois de ready volta a none", async () => {
    const m = managed();
    await m.manager.start("card-a");
    m.waits[0]?.settle("ready");
    await poll(() => processes(m)[0]?.[2] === "ready", 400);
    expect(processes(m)[0]?.[2]).toBe("ready");
    m.finish("term-1", 0);
    await poll(() => processes(m)[0]?.[2] === "none", 400);
    expect(processes(m)[0]?.[2]).toBe("none");
  });
});
