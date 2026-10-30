import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SessionNameInfo } from "@flightdeck/protocol";
import { Central } from "../src/central/central.ts";
import { Names } from "../src/names/names.ts";
import { trackNames } from "../src/names/track.ts";
import { startServer } from "../src/server.ts";
import { newManager, poll, tempDir } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

const TOKEN = "nomes-token-0123456789abcdef0";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function setup(options: { names?: boolean } = {}) {
  const { manager, store, project } = newManager();
  const dir = tempDir();
  const configFile = join(dir, "config.json");
  writeFileSync(configFile, "{}");
  const central = new Central({
    db: store.db,
    manager,
    hooks: { port: 0, permissionTimeoutS: 600, staleAfterS: 900 },
    dataDir: join(dir, "data"),
    hostName: "h",
    configFile,
    selfCommand: ["flightdeckd"],
    settingsPath: () => join(dir, "settings.json"),
  });
  cleanups.push(() => central.stop());
  const names = new Names(store.db);
  cleanups.push(
    trackNames({
      names,
      manager,
      external: central.external,
      projectOf: (cwd) => cwd,
      cardOf: () => null,
    }),
  );
  const server = startServer({
    manager,
    central,
    ...(options.names === false ? {} : { names }),
    hostName: "h",
    bind: "127.0.0.1",
    port: 0,
    token: TOKEN,
    allowedRoots: [],
  });
  cleanups.push(() => server.stop());
  const { sessionId } = manager.create({ cwd: project, prompt: "oi" });
  const claudeId = (await poll(() => manager.get(sessionId).claudeSessionId)) ?? "";
  central.external.apply("SessionStart", { session_id: "e1", cwd: "/work/loja" });
  const client = new FrameClient(server.url);
  cleanups.push(() => client.close());
  await client.request("hello", { token: TOKEN, client: "t" });
  const listed = async () =>
    (await client.data<{ names: SessionNameInfo[] }>("names.list", {}))?.names ?? [];
  return { client, names, sessionId, claudeId, project, listed };
}

describe("nomes-sessao-protocolo", () => {
  test("names.list traz o nome e os apelidos de cada sessão do host, a do app e a do terminal", async () => {
    const { listed, sessionId } = await setup();
    const all = await listed();
    expect(all.map((n) => n.sessionId).sort()).toEqual(["e1", sessionId].sort());
    expect(all.find((n) => n.sessionId === "e1")).toEqual({
      sessionId: "e1",
      display: "loja · geral · 1",
      alias: "loja-geral-1",
      aliases: ["loja-geral-1"],
      project: "loja",
      persona: "geral",
      number: 1,
      cardNumber: null,
    });
  });

  test("sem o serviço de nomes, names.list responde invalid_state", async () => {
    const { client } = await setup({ names: false });
    const ack = await client.request("names.list", {});
    expect(ack.ok).toBe(false);
    expect(JSON.stringify(ack)).toContain("invalid_state");
  });

  test("dar nome a uma sessão do terminal pela meta renomeia o nome padronizado e guarda o apelido", async () => {
    const { client, listed } = await setup();
    await client.request("session.meta.set", { claudeSessionId: "e1", name: "Vitrine da loja" });
    const renamed = (await listed()).find((n) => n.sessionId === "e1");
    expect(renamed).toMatchObject({
      display: "Vitrine da loja",
      aliases: ["loja-geral-1", "vitrine-da-loja"],
    });
  });

  test("o mesmo vale para a sessão gerenciada, achada pelo id do Claude", async () => {
    const { client, listed, sessionId, claudeId } = await setup();
    await client.request("session.meta.set", { claudeSessionId: claudeId, name: "Corrigir login" });
    const renamed = (await listed()).find((n) => n.sessionId === sessionId);
    expect(renamed?.display).toBe("Corrigir login");
    expect(renamed?.aliases.at(-1)).toBe("corrigir-login");
  });

  test("fixar, arquivar, limpar o nome ou nomear uma sessão que ninguém nomeou não mexe nos nomes", async () => {
    const { client, listed } = await setup();
    const before = await listed();
    expect(before).toHaveLength(2);
    await client.request("session.meta.set", { claudeSessionId: "e1", pinned: true });
    await client.request("session.meta.set", { claudeSessionId: "e1", name: null });
    await client.request("session.meta.set", { claudeSessionId: "e1", name: "   " });
    const unknown = await client.request("session.meta.set", {
      claudeSessionId: "h1",
      name: "do histórico",
    });
    expect(unknown.ok).toBe(true);
    expect(await listed()).toEqual(before);
  });
});
