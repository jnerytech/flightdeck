import { describe, expect, test } from "bun:test";
import {
  CardPorts,
  DEFAULT_PORT_BASE,
  interpolatePorts,
  loopbackFree,
  portEnv,
} from "../src/runenv/ports.ts";
import { EventStore } from "../src/store/event-store.ts";
import { newBoard } from "./board-helpers.ts";

const WEB_API = ["web", "api"];

function ports(options: { base?: number; busy?: number[] } = {}) {
  const store = new EventStore(":memory:");
  const busy = new Set(options.busy ?? []);
  const asked: number[] = [];
  const make = () =>
    new CardPorts({
      db: store.db,
      ...(options.base === undefined ? {} : { base: options.base }),
      isFree: async (port) => {
        asked.push(port);
        return !busy.has(port);
      },
    });
  return { store, busy, asked, ports: make(), make };
}

describe("portas: o bloco de cada card", () => {
  test("o padrão é 41000, e dois cards ganham blocos de 10 portas seguidos, sem colisão", async () => {
    const { ports: p } = ports();
    expect(DEFAULT_PORT_BASE).toBe(41000);
    expect(await p.reserve("card-a", WEB_API)).toEqual({ web: 41000, api: 41001 });
    expect(await p.reserve("card-b", WEB_API)).toEqual({ web: 41010, api: 41011 });
    expect(p.blockOf("card-a")).toBe(41000);
    expect(p.blockOf("card-b")).toBe(41010);
    expect(p.blockOf("card-c")).toBeNull();
  });

  test("a posição do nome na lista é a porta dentro do bloco, e pedir de novo devolve as mesmas", async () => {
    const { ports: p } = ports();
    const first = await p.reserve("card-a", ["web", "api", "db"]);
    expect(first).toEqual({ web: 41000, api: 41001, db: 41002 });
    expect(await p.reserve("card-a", ["web", "api", "db"])).toEqual(first);
    expect(await p.reserve("card-a", ["api", "web"])).toEqual({ api: 41000, web: 41001 });
    expect(await p.reserve("card-b", [])).toEqual({});
    expect(p.blockOf("card-b")).toBe(41010);
  });

  test("pedidos ao mesmo tempo não colidem", async () => {
    const { ports: p } = ports();
    const [a, b, c] = await Promise.all([
      p.reserve("card-a", ["web"]),
      p.reserve("card-b", ["web"]),
      p.reserve("card-c", ["web"]),
    ]);
    expect([a.web, b.web, c.web]).toEqual([41000, 41010, 41020]);
  });

  test("um bloco com uma porta ocupada no sistema é pulado, e o card fica com o seguinte", async () => {
    const { ports: p, asked } = ports({ busy: [41003] });
    expect(await p.reserve("card-a", WEB_API)).toEqual({ web: 41010, api: 41011 });
    expect(asked.slice(0, 4)).toEqual([41000, 41001, 41002, 41003]);
  });

  test("o bloco é do card até ele ser concluído: liberar devolve o menor bloco livre", async () => {
    const { ports: p } = ports();
    await p.reserve("card-a", WEB_API);
    await p.reserve("card-b", WEB_API);
    p.release("card-a");
    p.release("card-desconhecido");
    expect(p.blockOf("card-a")).toBeNull();
    expect(await p.reserve("card-c", WEB_API)).toEqual({ web: 41000, api: 41001 });
    expect(p.blockOf("card-b")).toBe(41010);
  });

  test("run.portBase muda onde os blocos começam", async () => {
    const { ports: p } = ports({ base: 52000 });
    expect(await p.reserve("card-a", ["web"])).toEqual({ web: 52000 });
    expect(await p.reserve("card-b", ["web"])).toEqual({ web: 52010 });
  });

  test("sem bloco inteiro até a última porta (65535), o card recebe um erro claro", async () => {
    const { ports: p } = ports({ base: 65530 });
    await expect(p.reserve("card-a", ["web"])).rejects.toThrow("sem bloco de 10 portas livres");
    expect(p.blockOf("card-a")).toBeNull();
  });

  test("a reserva sobrevive a reiniciar o daemon: o mesmo banco devolve o mesmo bloco", async () => {
    const { ports: p, make } = ports();
    await p.reserve("card-a", WEB_API);
    const again = make();
    expect(again.blockOf("card-a")).toBe(41000);
    expect(await again.reserve("card-a", WEB_API)).toEqual({ web: 41000, api: 41001 });
    expect(await again.reserve("card-b", WEB_API)).toEqual({ web: 41010, api: 41011 });
  });
});

describe("portas: liberado ao concluir", () => {
  test("o card que chega a done devolve o bloco; um card em andamento o mantém", async () => {
    const ctx = newBoard();
    const project = await ctx.board.addProject({ path: ctx.repo });
    const cardA = ctx.board.createCard(project.id, { title: "A", description: "faça" });
    const cardB = ctx.board.createCard(project.id, { title: "B", description: "faça" });
    const p = new CardPorts({ db: ctx.store.db, isFree: async () => true });
    const stop = p.follow((listener) => ctx.board.watch(listener));
    await p.reserve(cardA.id, WEB_API);
    await p.reserve(cardB.id, WEB_API);
    ctx.board.moveCard(cardA.id, "review");
    expect(p.blockOf(cardA.id)).toBe(41000);
    ctx.board.moveCard(cardA.id, "done");
    expect(p.blockOf(cardA.id)).toBeNull();
    expect(p.blockOf(cardB.id)).toBe(41010);
    stop();
    await p.reserve(cardA.id, WEB_API);
    ctx.board.moveCard(cardA.id, "backlog");
    ctx.board.moveCard(cardA.id, "done");
    expect(p.blockOf(cardA.id)).toBe(41000);
  });
});

describe("portas: variáveis e referências", () => {
  test("cada porta vai no ambiente como FLIGHTDECK_PORT_<NOME>, em maiúsculas e com _", () => {
    expect(portEnv({ web: 41000, "api-v2": 41001 })).toEqual({
      FLIGHTDECK_PORT_WEB: "41000",
      FLIGHTDECK_PORT_API_V2: "41001",
    });
    expect(portEnv({})).toEqual({});
  });

  test("{{port.nome}} vira o número, com ou sem espaços; uma porta sem bloco é um erro", () => {
    const map = { web: 41000, api: 41001 };
    expect(interpolatePorts("--port={{port.web}}", map)).toBe("--port=41000");
    expect(interpolatePorts("http://127.0.0.1:{{ port.api }}/", map)).toBe(
      "http://127.0.0.1:41001/",
    );
    expect(interpolatePorts("sem referência", map)).toBe("sem referência");
    expect(() => interpolatePorts("{{port.db}}", map)).toThrow("porta sem bloco: db");
  });
});

describe("portas: a sonda real", () => {
  test("uma porta em uso no loopback não está livre, e volta a estar quando é solta", async () => {
    // A port the system hands out (not a fixed one): it is in use while the server lives.
    const server = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: { data() {}, open() {} },
    });
    const { port } = server;
    expect(await loopbackFree(port)).toBe(false);
    server.stop(true);
    expect(await loopbackFree(port)).toBe(true);
  });
});
