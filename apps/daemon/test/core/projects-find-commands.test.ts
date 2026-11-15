import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import * as protocol from "@flightdeck/protocol";
import { type RunningServer, startServer } from "../../src/server.ts";
import { BASELINE_FEATURES, newManager, poll } from "../support/helpers.ts";
import { fakeGit, tree } from "../support/projects-find.ts";

const TOKEN = "projects-find-token-0123456789";
const stops: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
});

async function ask(server: RunningServer, type: string, payload: object) {
  const ws = new WebSocket(server.url);
  const acks: protocol.Ack[] = [];
  ws.addEventListener("message", (m) => {
    const msg = protocol.parseServerMessage(String(m.data));
    if (msg.type === "ack") acks.push(msg);
  });
  await new Promise((r) => ws.addEventListener("open", r));
  ws.send(JSON.stringify({ id: "1", type: "hello", payload: { token: TOKEN, client: "t" } }));
  ws.send(JSON.stringify({ id: "2", type, payload }));
  const ack = await poll(() => acks.find((a) => a.id === "2"), 2000);
  ws.close();
  return ack;
}

function server(root: string, extra: Partial<Parameters<typeof startServer>[0]> = {}) {
  const started = startServer({
    manager: newManager().manager,
    hostName: "h",
    bind: "127.0.0.1",
    port: 0,
    token: TOKEN,
    allowedRoots: [root],
    ...extra,
  });
  stops.push(() => started.stop());
  return started;
}

describe("projetos-busca: the commands", () => {
  test("payloads: scan takes a bounded depth, clone takes a URL, a root and a name", () => {
    const parse = (type: string, payload: object) =>
      protocol.Command.safeParse({ id: "1", type, payload }).success;
    expect(parse("projects.scan", {})).toBe(true);
    expect(parse("projects.scan", { depth: 3 })).toBe(true);
    expect(parse("projects.scan", { depth: 4 })).toBe(false);
    expect(parse("projects.clone", { url: "https://a/b.git", root: "/r", name: "n" })).toBe(true);
    expect(parse("projects.clone", { url: "", root: "/r" })).toBe(false);
    expect(parse("projects.clone", { url: "https://a/b.git" })).toBe(false);
  });

  test("scan and clone answer for the allowed roots; host.info announces them", async () => {
    const { root } = tree();
    const { git, calls } = fakeGit();
    const running = server(root, { projects: { find: true }, git });
    const scan = await ask(running, "projects.scan", {});
    expect(scan?.ok && (scan.data as protocol.ProjectsScanResult).repos).toHaveLength(3);
    const url = "https://example.com/acme/new.git";
    const clone = await ask(running, "projects.clone", { url, root });
    expect(clone?.ok && clone.data).toEqual({ path: join(root, "new") });
    expect(calls).toHaveLength(1);
    const refused = await ask(running, "projects.clone", { url: "file:///x", root });
    expect(refused && !refused.ok && refused.error.reason).toBe("clone_url_scheme");
    const info = await ask(running, "host.info", {});
    expect(info?.ok && (info.data as { features: string[] }).features).toEqual(
      expect.arrayContaining(["projects.scan", "projects.clone"]),
    );
  });

  test("a daemon without the feature refuses both and announces nothing", async () => {
    const { root } = tree();
    const bare = server(root);
    const scan = await ask(bare, "projects.scan", {});
    expect(scan && !scan.ok && scan.error.reason).toBe("feature_off");
    const clone = await ask(bare, "projects.clone", { url: "https://a/b.git", root });
    expect(clone && !clone.ok && clone.error.reason).toBe("feature_off");
    const info = await ask(bare, "host.info", {});
    expect(info?.ok && (info.data as { features: string[] }).features).toEqual([
      ...BASELINE_FEATURES,
    ]);
  });
});
