import { describe, expect, test } from "bun:test";
import type { RunConfig } from "../src/runenv/config.ts";
import { RunManager, type RunState } from "../src/runenv/manager.ts";
import { CardPorts } from "../src/runenv/ports.ts";
import { EventStore } from "../src/store/event-store.ts";
import { poll } from "./helpers.ts";
import { fakeRunHost, runConfig } from "./run-helpers.ts";

const WORKTREE = (id: string) => `/work/${id}`;

/** Waits briefly for a condition: it answers `null` on timeout, so the `expect` after it fails. */
const until = <T>(check: () => T | undefined | null | false) => poll(check, 400);

/** A manager over a fake host, injected cards and a config; `config` can change between starts. */
function setup(initial: RunConfig = runConfig()) {
  let config = initial;
  const fake = fakeRunHost();
  const store = new EventStore(":memory:");
  const ports = new CardPorts({ db: store.db, isFree: async () => true });
  const noWorktree = new Set<string>();
  const failing = new Set<string>();
  const makeManager = () =>
    new RunManager({
      db: store.db,
      configs: {
        resolve: async (project) => {
          if (failing.has(project.id))
            throw new Error("run.yaml não confiado; confie nele no card");
          return config;
        },
      },
      ports,
      host: fake.host,
      card: (cardId) => ({
        id: cardId,
        projectId: "proj",
        worktreePath: noWorktree.has(cardId) ? null : WORKTREE(cardId),
      }),
      project: (id) => ({ id, path: "/repo", baseBranch: "main" }),
    });
  const manager = makeManager();
  const states: RunState[] = [];
  manager.watch((state) => states.push(state));
  const status = (cardId: string) => manager.state(cardId).status;
  return {
    /** The daemon starts again over the same database. */
    restarted: makeManager,
    manager,
    ports,
    states,
    noWorktree,
    failing,
    setConfig: (next: RunConfig) => {
      config = next;
    },
    status,
    ...fake,
  };
}

/** Starts a card and lets its (successful) setup end. */
async function started(s: ReturnType<typeof setup>, cardId = "card-a") {
  await s.manager.start(cardId);
  const prepare = await until(() => s.of("prepare").at(-1));
  if (prepare) s.finish(prepare.terminalId, 0);
  await until(() => s.status(cardId) === "running");
}

describe("run-execucao: o setup", () => {
  test("roda uma vez por card, numa aba, na worktree, antes dos processos", async () => {
    const s = setup();
    const first = await s.manager.start("card-a");
    expect(first.status).toBe("setup");
    expect(first.setup).toBe("running");
    expect(s.spawned.map((r) => r.argv[0])).toEqual(["prepare"]);
    expect(s.spawned[0]?.cwd).toBe(WORKTREE("card-a"));
    s.finish("term-1", 0);
    await until(() => s.status("card-a") === "running");
    expect(s.spawned.map((r) => r.argv[0])).toEqual(["prepare", "serve", "api"]);
    expect(s.manager.state("card-a").setup).toBe("done");
    await s.manager.stop("card-a");
    await s.manager.start("card-a");
    expect(s.of("prepare")).toHaveLength(1);
    expect(s.of("serve")).toHaveLength(2);
  });

  test("um processo que o sistema recusa (terminais desligados, limite) falha o Run com o motivo e encerra os que subiram", async () => {
    const s = setup(runConfig({ setup: null }));
    s.refused.set("api", "limite de 10 terminais por host");
    await s.manager.start("card-a");
    await until(() => s.status("card-a") === "failed");
    const state = s.manager.state("card-a");
    expect(state.error).toBe("não consegui iniciar api: limite de 10 terminais por host");
    expect(s.of("serve")[0]?.killed).toBe(true);
    expect(state.processes.map((p) => p.status)).toEqual(["exited"]);
    s.refused.delete("api");
    await s.manager.start("card-a");
    expect(s.of("api")).toHaveLength(1);
  });

  test("um setup que o sistema recusa falha o Run com o motivo", async () => {
    const s = setup();
    s.refused.set("prepare", "terminal desligado neste host");
    await s.manager.start("card-a");
    await until(() => s.status("card-a") === "failed");
    expect(s.manager.state("card-a").error).toBe(
      "não consegui iniciar o setup: terminal desligado neste host",
    );
    expect(s.manager.state("card-a").setup).toBe("failed");
  });

  test("o setup também não roda de novo depois de o daemon reiniciar", async () => {
    const s = setup();
    await started(s);
    await s.manager.stop("card-a");
    const next = s.restarted();
    await next.start("card-a");
    expect(s.of("prepare")).toHaveLength(1);
    expect(s.of("serve")).toHaveLength(2);
  });

  test("um setup que falha para tudo, mostra o código e é tentado de novo no próximo Run", async () => {
    const s = setup();
    await s.manager.start("card-a");
    s.finish("term-1", 3);
    await until(() => s.status("card-a") === "failed");
    const state = s.manager.state("card-a");
    expect(state.setup).toBe("failed");
    expect(state.error).toBe("o setup falhou (código 3)");
    expect(s.of("serve")).toHaveLength(0);
    await s.manager.start("card-a");
    expect(s.of("prepare")).toHaveLength(2);
    s.finish("term-2", 0);
    await until(() => s.status("card-a") === "running");
    expect(s.manager.state("card-a").error).toBeNull();
  });

  test("sem setup no arquivo, os processos sobem direto", async () => {
    const s = setup(runConfig({ setup: null }));
    const state = await s.manager.start("card-a");
    expect(state.status).toBe("running");
    expect(state.setup).toBe("pending");
    expect(s.spawned.map((r) => r.argv[0])).toEqual(["serve", "api"]);
  });
});

describe("run-execucao: os processos", () => {
  test("cada processo vira uma aba na worktree, com a porta no comando e no ambiente", async () => {
    const s = setup();
    await started(s);
    const [, web, api] = s.spawned;
    expect(web?.argv).toEqual(["serve", "--port", "41000"]);
    expect(web?.cwd).toBe(WORKTREE("card-a"));
    expect(web?.env).toMatchObject({ FLIGHTDECK_PORT_WEB: "41000", FLIGHTDECK_PORT_API: "41001" });
    expect(api?.argv).toEqual(["api"]);
    expect(api?.env).toMatchObject({ PORT: "41001", FLIGHTDECK_PORT_API: "41001" });
    const state = s.manager.state("card-a");
    expect(state.ports).toEqual({ web: 41000, api: 41001 });
    expect(state.processes).toEqual([
      { name: "web", terminalId: web?.terminalId ?? "", status: "running", exitCode: null },
      { name: "api", terminalId: api?.terminalId ?? "", status: "running", exitCode: null },
    ]);
  });

  test("um processo que acaba mostra o código; o Run termina quando o último acaba", async () => {
    const s = setup();
    await started(s);
    s.finish("term-2", 1);
    await until(() => s.manager.state("card-a").processes[0]?.status === "exited");
    expect(s.manager.state("card-a").processes[0]?.exitCode).toBe(1);
    expect(s.status("card-a")).toBe("running");
    s.finish("term-3", 0);
    await until(() => s.status("card-a") === "ended");
    expect(s.manager.state("card-a").processes.map((p) => p.exitCode)).toEqual([1, 0]);
  });

  test("quem acompanha recebe o estado a cada mudança", async () => {
    const s = setup();
    await started(s);
    const before = s.states.length;
    s.finish("term-2", 0);
    await until(() => s.states.length > before);
    expect(s.states.at(-1)?.processes[0]?.status).toBe("exited");
    expect(s.states.at(-1)?.cardId).toBe("card-a");
  });

  test("quem para de acompanhar não recebe mais nada", async () => {
    const s = setup(runConfig({ setup: null }));
    const heard: string[] = [];
    const stop = s.manager.watch((state) => heard.push(state.status));
    await s.manager.start("card-a");
    const count = heard.length;
    expect(count).toBeGreaterThan(0);
    stop();
    await s.manager.stop("card-a");
    expect(heard).toHaveLength(count);
  });

  test("Run com o card já rodando devolve o estado, sem subir nada de novo", async () => {
    const s = setup();
    await started(s);
    const count = s.spawned.length;
    const again = await s.manager.start("card-a");
    expect(again.status).toBe("running");
    expect(s.spawned).toHaveLength(count);
  });

  test("um card sem worktree ou com o run.yaml não confiado é recusado, sem reservar nada", async () => {
    const s = setup();
    s.noWorktree.add("card-a");
    await expect(s.manager.start("card-a")).rejects.toThrow("card ainda sem worktree");
    s.failing.add("proj");
    await expect(s.manager.start("card-b")).rejects.toThrow("não confiado");
    expect(s.ports.blockOf("card-a")).toBeNull();
    expect(s.ports.blockOf("card-b")).toBeNull();
    expect(s.spawned).toHaveLength(0);
  });
});

describe("run-execucao: o Stop", () => {
  test("encerra todos os processos, mostra o fim e devolve o estado", async () => {
    const s = setup();
    await started(s);
    const state = await s.manager.stop("card-a");
    expect(s.spawned.filter((r) => r.killed).map((r) => r.argv[0])).toEqual(["serve", "api"]);
    expect(state.status).toBe("ended");
    expect(state.processes.map((p) => p.status)).toEqual(["exited", "exited"]);
  });

  test("durante o setup, o Stop encerra o setup e nada sobe depois", async () => {
    const s = setup();
    await s.manager.start("card-a");
    const state = await s.manager.stop("card-a");
    expect(s.spawned[0]?.killed).toBe(true);
    expect(state.status).toBe("ended");
    await Bun.sleep(20);
    expect(s.of("serve")).toHaveLength(0);
    expect(s.manager.state("card-a").setup).toBe("pending");
  });

  test("Stop de um card que não roda não faz nada", async () => {
    const s = setup();
    const state = await s.manager.stop("card-a");
    expect(state.status).toBe("idle");
    expect(s.spawned).toHaveLength(0);
  });

  test("as portas ficam com o card depois do Stop, até ele ser concluído", async () => {
    const s = setup();
    await started(s);
    await s.manager.stop("card-a");
    expect(s.ports.blockOf("card-a")).toBe(41000);
    await s.manager.start("card-a");
    expect(s.of("serve").at(-1)?.argv).toEqual(["serve", "--port", "41000"]);
  });

  test("o card que chega a done tem os processos encerrados; outro card segue rodando", async () => {
    const s = setup(runConfig({ setup: null }));
    let notify: (card: { id: string; column: string }) => void = () => {};
    s.manager.follow((listener) => {
      notify = listener;
      return () => {};
    });
    await s.manager.start("card-a");
    await s.manager.start("card-b");
    notify({ id: "card-a", column: "review" });
    expect(s.status("card-a")).toBe("running");
    notify({ id: "card-a", column: "done" });
    await until(() => s.status("card-a") === "ended");
    expect(s.status("card-b")).toBe("running");
  });
});

describe("run-execucao: o modo não concorrente", () => {
  test("com exclusive, um card roda de cada vez no projeto; depois do Stop o outro pode", async () => {
    const s = setup(runConfig({ exclusive: true, setup: null }));
    await s.manager.start("card-a");
    await expect(s.manager.start("card-b")).rejects.toThrow(
      "outro card está rodando neste projeto (modo não concorrente)",
    );
    expect(s.ports.blockOf("card-b")).toBeNull();
    await s.manager.stop("card-a");
    expect((await s.manager.start("card-b")).status).toBe("running");
  });

  test("sem exclusive, dois cards rodam ao mesmo tempo em blocos de portas diferentes", async () => {
    const s = setup(runConfig({ setup: null }));
    const a = await s.manager.start("card-a");
    const b = await s.manager.start("card-b");
    expect([a.status, b.status]).toEqual(["running", "running"]);
    expect(a.ports.web).toBe(41000);
    expect(b.ports.web).toBe(41010);
  });
});
