import { afterEach, describe, expect, test } from "bun:test";
import { CLOSE_UNAUTHORIZED } from "@flightdeck/protocol";
import { HostRosterSlice } from "../../src/features/hosts/index.ts";
import { translator } from "../../src/i18n/index.ts";

const t = translator("en");

/** A daemon that answers `hello` and `host.info`, or refuses the token, on a free local port. */
function daemon(mode: "ok" | "refuse") {
  const server = Bun.serve({
    port: 0,
    fetch(req, srv) {
      return srv.upgrade(req) ? undefined : new Response("no", { status: 400 });
    },
    websocket: {
      open(ws) {
        if (mode === "refuse") ws.close(CLOSE_UNAUTHORIZED);
      },
      message(ws, raw) {
        const { id } = JSON.parse(String(raw)) as { id: string };
        ws.send(JSON.stringify({ id, type: "ack", ok: true, data: {} }));
      },
    },
  });
  return { url: `ws://127.0.0.1:${server.port}`, stop: () => server.stop(true) };
}

const open: Array<{ stop: () => void }> = [];
afterEach(() => {
  for (const server of open.splice(0)) server.stop();
});
const serve = (mode: "ok" | "refuse") => {
  const started = daemon(mode);
  open.push(started);
  return started.url;
};

/** A roster over stand-ins: the order of what it did, and the secrets it kept. */
function roster(hosts: Array<{ id: string; name: string; url: string }> = []) {
  const log: string[] = [];
  const secrets = new Map<string, string>();
  const listed = [...hosts];
  const slice = new HostRosterSlice({
    secrets: {
      get: async (id) => secrets.get(id) ?? null,
      set: async (id, value) => {
        log.push(`secret.set ${id}`);
        secrets.set(id, value);
      },
      delete: async (id) => {
        log.push(`secret.delete ${id}`);
        secrets.delete(id);
      },
    },
    hosts: () => listed,
    list: (config) => {
      log.push(`list ${config.name}`);
      listed.push(config);
    },
    persist: () => void log.push("persist"),
    connect: (config, token) => void log.push(`connect ${config.id} ${token}`),
    stop: (hostId) => void log.push(`stop ${hostId}`),
    detach: (hostId) => void log.push(`detach ${hostId}`),
    forget: (hostId) => {
      log.push(`forget ${hostId}`);
      const at = listed.findIndex((h) => h.id === hostId);
      if (at >= 0) listed.splice(at, 1);
    },
    setName: (hostId, name) => {
      log.push(`name ${hostId} ${name}`);
      const host = listed.find((h) => h.id === hostId);
      if (host) host.name = name;
    },
    rememberToken: (token) => void log.push(`remember ${token}`),
    addRoot: async (hostId, folder) => {
      log.push(`roots.add ${hostId} ${folder}`);
      return { allowedRoots: [folder] };
    },
    setAllowedRoots: (hostId, roots) => void log.push(`roots ${hostId} ${roots.join(",")}`),
    success: (text) => void log.push(`success ${text}`),
    t: () => t,
  });
  return { slice, log, secrets, listed };
}

describe("host roster (#1596)", () => {
  test("a host is added with its token in the secrets store, listed, saved and connected, in that order", async () => {
    const { slice, log, secrets, listed } = roster();
    const id = await slice.add({ name: "box", url: "ws://10.0.0.2:7600", token: "tok-1" });
    expect({ log, kept: secrets.get(id), listed: listed.map((h) => h.url) }).toEqual({
      log: [`secret.set ${id}`, "list box", "persist", `connect ${id} tok-1`],
      kept: "tok-1",
      listed: ["ws://10.0.0.2:7600"],
    });
  });

  test("a host that answers is added after the test, and one that refuses the token is not", async () => {
    const good = roster();
    const bad = roster();
    const added = await good.slice.testAndAdd({ name: "ok", url: serve("ok"), token: "tok-2" });
    const refused = await bad.slice.testAndAdd({
      name: "no",
      url: serve("refuse"),
      token: "tok-3",
    });
    expect({
      added: added.ok,
      goodLog: good.log.filter((l) => l.startsWith("remember") || l.startsWith("list")),
      refused,
      badLog: bad.log,
    }).toEqual({
      added: true,
      goodLog: ["remember tok-2", "list ok"],
      refused: { ok: false, error: t("hostForm.probeRefused") },
      badLog: ["remember tok-3"],
    });
  });

  test("removing a host closes it, then deletes its secret, then forgets it and saves the list", async () => {
    const { slice, log, secrets } = roster([{ id: "a", name: "alfa", url: "ws://a" }]);
    secrets.set("a", "tok");
    await slice.remove("a");
    expect({ log, secret: secrets.has("a") }).toEqual({
      log: ["detach a", "secret.delete a", "forget a", "persist"],
      secret: false,
    });
  });

  test("a name is trimmed, saved, and refused when empty or taken by another host", () => {
    const { slice, log, listed } = roster([
      { id: "a", name: "alfa", url: "ws://a" },
      { id: "b", name: "beta", url: "ws://b" },
    ]);
    const results = [
      slice.rename("a", "  gama  "),
      slice.rename("a", "   "),
      slice.rename("a", "BETA"),
      slice.rename("b", "beta"),
    ];
    expect({ results, names: listed.map((h) => h.name), log }).toEqual({
      results: [null, "empty", "duplicate", null],
      names: ["gama", "beta"],
      log: ["name a gama", "persist", "name b beta", "persist"],
    });
  });

  test("pairing again is refused for a host that is gone, a bad link and an empty token", async () => {
    const { slice, log } = roster([{ id: "a", name: "alfa", url: "ws://a" }]);
    expect({
      gone: await slice.pairAgain("nope", "tok"),
      empty: await slice.pairAgain("a", "   "),
      badLink: (await slice.pairAgain("a", "flightdeck://")) !== null,
      log,
    }).toEqual({
      gone: t("hostOffline.pairGone"),
      empty: t("hostForm.pairToken"),
      badLink: true,
      log: [],
    });
  });

  test("a token or a pairing link that the host accepts replaces the secret and reconnects", async () => {
    const url = serve("ok");
    const { slice, log, secrets } = roster([{ id: "a", name: "alfa", url }]);
    const typed = await slice.pairAgain("a", " tok-new ");
    const port = new URL(url).port;
    const linked = await slice.pairAgain("a", `flightdeck://127.0.0.1:${port}?token=tok-link`);
    expect({ typed, linked, kept: secrets.get("a"), log }).toEqual({
      typed: null,
      linked: null,
      kept: "tok-link",
      log: [
        "secret.set a",
        "stop a",
        `connect a tok-new`,
        "secret.set a",
        "stop a",
        "connect a tok-link",
      ],
    });
  });

  test("a host removed while its new token is tested keeps no secret", async () => {
    const { slice, log, secrets } = roster([{ id: "a", name: "alfa", url: serve("ok") }]);
    const pending = slice.pairAgain("a", "tok-late");
    await slice.remove("a");
    expect({ error: await pending, kept: secrets.has("a"), log }).toEqual({
      error: t("hostOffline.pairGone"),
      kept: false,
      log: ["detach a", "secret.delete a", "forget a", "persist"],
    });
  });

  test("a token the host refuses is not kept", async () => {
    const { slice, log, secrets } = roster([{ id: "a", name: "alfa", url: serve("refuse") }]);
    const error = await slice.pairAgain("a", "wrong");
    expect({ error, log, kept: secrets.has("a") }).toEqual({
      error: t("hostForm.probeRefused"),
      log: [],
      kept: false,
    });
  });

  test("reconnecting stops the connection and opens a new one only when the token is kept", async () => {
    const { slice, log, secrets } = roster([
      { id: "a", name: "alfa", url: "ws://a" },
      { id: "b", name: "beta", url: "ws://b" },
    ]);
    secrets.set("a", "tok-a");
    await slice.reconnect("a");
    await slice.reconnect("b");
    expect(log).toEqual(["stop a", "connect a tok-a", "stop b"]);
  });
});
