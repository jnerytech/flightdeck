import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { formatPairingLink, parsePairingLink } from "@flightdeck/protocol";
import { type CliDeps, runCli, startDaemon } from "../src/main.ts";
import { pairingAddress } from "../src/pairing.ts";
import { poll, tempDir } from "./helpers.ts";

const stops: Array<() => Promise<void>> = [];
const sockets: WebSocket[] = [];
afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.close();
  for (const stop of stops.splice(0)) await stop();
});

function config(extra: Record<string, unknown> = {}) {
  const dir = tempDir();
  const file = join(dir, "config.json");
  const token = "token-antigo-0123456789abcdef";
  writeFileSync(
    file,
    JSON.stringify({
      hostName: "orange pi",
      port: 7421,
      token,
      dataDir: join(dir, "data"),
      ...extra,
    }),
  );
  return { file, token };
}

function deps(tailscale: string | null) {
  const out: string[] = [];
  const exits: number[] = [];
  const calls: string[][] = [];
  const cli: CliDeps = {
    env: {},
    log: { log: (m) => out.push(m), error: (m) => out.push(m) },
    exit: (code) => exits.push(code),
    onSignal: () => {},
    exec: async (cmd) => {
      calls.push(cmd);
      return cmd.join(" ") === "tailscale ip -4" && tailscale
        ? { code: 0, stdout: `${tailscale}\n` }
        : { code: 1, stdout: "" };
    },
  };
  return { cli, out, exits, calls };
}

function connect(url: string, token: string) {
  const ws = new WebSocket(url);
  sockets.push(ws);
  const state = { ok: null as boolean | null, closed: null as number | null };
  ws.addEventListener("open", () =>
    ws.send(JSON.stringify({ id: "1", type: "hello", payload: { token, client: "t" } })),
  );
  ws.addEventListener("message", (m) => {
    const msg = JSON.parse(String(m.data));
    if (msg.type === "ack") state.ok = msg.ok;
  });
  ws.addEventListener("close", (e) => {
    state.closed = e.code;
  });
  return state;
}

const runFake = (file: string) =>
  startDaemon(
    { command: "start", config: file, runtime: "fake" },
    {},
    { log: () => {}, error: () => {} },
    { configWatchMs: 20 },
  );

describe("pareamento", () => {
  test("a string gerada é lida de volta pelo parser do app", () => {
    for (const address of ["100.101.102.103", "fd7a:115c:a1e0::5", "meu-pc.tailnet.ts.net"]) {
      const link = formatPairingLink({
        address,
        port: 7421,
        name: "Orange Pi ção",
        token: "a+b/c=d_e-f",
      });
      expect(link.startsWith("flightdeck://")).toBe(true);
      const host = address.includes(":") ? `[${address}]` : address;
      expect(parsePairingLink(link)).toEqual({
        ok: true,
        value: { name: "Orange Pi ção", url: `ws://${host}:7421/v1/ws`, token: "a+b/c=d_e-f" },
      });
    }
  });

  test("o parser recusa esquema errado, endereço, porta inválida e token ausente; sem nome usa o endereço", () => {
    expect(parsePairingLink("http://pc:7420?token=t")).toEqual({
      ok: false,
      error: "esquema inválido",
    });
    expect(parsePairingLink("flightdeck://:7420?token=t")).toEqual({
      ok: false,
      error: "endereço inválido",
    });
    for (const port of ["", "0", "65536", "abc"]) {
      expect(parsePairingLink(`flightdeck://pc:${port}?token=t`)).toEqual({
        ok: false,
        error: "porta inválida",
      });
    }
    expect(parsePairingLink("flightdeck://pc:7420?name=x")).toEqual({
      ok: false,
      error: "token ausente",
    });
    expect(parsePairingLink(" FLIGHTDECK://pc:7420/?token=t ")).toEqual({
      ok: true,
      value: { name: "pc", url: "ws://pc:7420/v1/ws", token: "t" },
    });
  });

  test("endereço: o que o daemon escuta; a Tailscale só entra quando ele escuta nela", () => {
    // Loopback: nenhuma outra máquina chega, a Tailscale não ajuda.
    expect(pairingAddress("127.0.0.1", "100.64.1.2")).toBe("127.0.0.1");
    expect(pairingAddress("::1", "100.64.1.2")).toBe("::1");
    expect(pairingAddress("localhost", "100.64.1.2")).toBe("localhost");
    // Todas as interfaces: a Tailscale, se houver; senão o loopback.
    expect(pairingAddress("0.0.0.0", "100.64.1.2")).toBe("100.64.1.2");
    expect(pairingAddress("::", "100.64.1.2")).toBe("100.64.1.2");
    expect(pairingAddress("0.0.0.0", null)).toBe("127.0.0.1");
    expect(pairingAddress("::", null)).toBe("::1");
    // Um endereço próprio: ele mesmo, mesmo com a Tailscale no PATH.
    expect(pairingAddress("192.168.0.10", null)).toBe("192.168.0.10");
    expect(pairingAddress("192.168.0.10", "100.64.1.2")).toBe("192.168.0.10");
    expect(pairingAddress("100.64.1.2", "100.64.1.2")).toBe("100.64.1.2");
  });

  test("flightdeckd pair imprime o link e o QR; com o daemon só no loopback, o link é do loopback e o aviso diz como abrir", async () => {
    const { file, token } = config();
    const { cli, out, exits, calls } = deps("100.64.1.2");
    expect(await runCli(["pair", "--config", file], cli)).toBeNull();
    expect(exits).toEqual([0]);
    expect(calls).toEqual([["tailscale", "ip", "-4"]]);
    const link = formatPairingLink({ address: "127.0.0.1", port: 7421, name: "orange pi", token });
    expect(out[0]).toBe(link);
    expect(out.slice(1).join("\n")).toMatch(/[█▀▄]/);
    expect(out.some((line) => line.includes("o daemon escuta só em 127.0.0.1"))).toBe(true);
    expect(out.some((line) => line.includes("100.64.1.2"))).toBe(true);
  });

  test("com o daemon em todas as interfaces e a Tailscale no ar, o link leva o IP da Tailscale, sem aviso", async () => {
    const { file, token } = config({ bind: "0.0.0.0" });
    const { cli, out } = deps("100.64.1.2");
    await runCli(["pair", "--config", file], cli);
    expect(out[0]).toBe(
      formatPairingLink({ address: "100.64.1.2", port: 7421, name: "orange pi", token }),
    );
    expect(out.some((line) => line.includes("escuta só em"))).toBe(false);
  });

  test("sem Tailscale, o loopback não leva aviso nenhum", async () => {
    const { file } = config();
    const { cli, out } = deps(null);
    await runCli(["pair", "--config", file], cli);
    expect(out.some((line) => line.includes("escuta só em"))).toBe(false);
  });

  test("pair sem Tailscale usa o bind", async () => {
    const { file, token } = config({ bind: "192.168.0.10" });
    const { cli, out } = deps(null);
    await runCli(["pair", "--config", file], cli);
    expect(parsePairingLink(out[0] ?? "")).toMatchObject({
      ok: true,
      value: { url: "ws://192.168.0.10:7421/v1/ws", token },
    });
  });

  test("tailscale ausente (exec lança erro) cai no bind", async () => {
    const { file } = config({ bind: "10.0.0.7" });
    const { cli, out } = deps(null);
    cli.exec = async () => {
      throw new Error("ENOENT: tailscale");
    };
    await runCli(["pair", "--config", file], cli);
    expect(parsePairingLink(out[0] ?? "")).toMatchObject({
      ok: true,
      value: { url: "ws://10.0.0.7:7421/v1/ws" },
    });
  });

  test("pair --rotate grava token novo e preserva o resto da config", async () => {
    const { file, token } = config({ allowedRoots: ["/x"] });
    const { cli, out } = deps(null);
    await runCli(["pair", "--rotate", "--config", file], cli);
    const saved = JSON.parse(readFileSync(file, "utf8"));
    expect(saved.token).not.toBe(token);
    expect(saved.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(saved).toMatchObject({ hostName: "orange pi", port: 7421, allowedRoots: ["/x"] });
    expect(parsePairingLink(out[0] ?? "")).toMatchObject({
      ok: true,
      value: { token: saved.token },
    });
  });

  test("--rotate derruba com 4401 as conexões do token antigo no daemon em execução", async () => {
    const { file, token } = config({ port: 0 });
    const daemon = await runFake(file);
    stops.push(() => daemon.stop());
    const old = connect(daemon.url, token);
    await poll(() => old.ok === true);
    expect(old.ok).toBe(true);

    await runCli(["pair", "--rotate", "--config", file], deps(null).cli);
    const fresh = JSON.parse(readFileSync(file, "utf8")).token as string;
    await poll(() => old.closed !== null, 1500);
    expect(old.closed).toBe(4401);
    const again = connect(daemon.url, token);
    const rotated = connect(daemon.url, fresh);
    await poll(() => again.closed !== null && rotated.ok !== null, 1500);
    expect(again.closed).toBe(4401);
    expect(rotated.ok).toBe(true);
  });

  test("config inválida durante a execução é ignorada e o token atual continua valendo", async () => {
    const { file, token } = config({ port: 0 });
    const daemon = await runFake(file);
    stops.push(() => daemon.stop());
    const before = connect(daemon.url, token);
    await poll(() => before.ok === true);
    writeFileSync(file, "{ meio escrito");
    await Bun.sleep(100);
    expect(before.closed).toBeNull();
    const client = connect(daemon.url, token);
    await poll(() => client.ok !== null || client.closed !== null);
    expect(client.ok).toBe(true);
  });
});
