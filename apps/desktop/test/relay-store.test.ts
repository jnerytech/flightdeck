import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { realTempDir } from "../../../scripts/test/temp-dir.ts";
import { runCli } from "../../daemon/src/main.ts";
import { FrameClient } from "../../daemon/test/history-helpers.ts";
import { memoryPlatform } from "./fixtures.ts";

const { AppStore } = await import("../src/lib/app-store.ts");

setDefaultTimeout(60_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function until<T>(check: () => Promise<T | null | undefined | false>, ms = 20_000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await Bun.sleep(100);
  }
  return null;
}

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "ignore" });

/** A `--runtime fake` daemon named `name`, with a clone of the same repository, and one idle session. */
async function host(name: string, origin: string) {
  const dir = realTempDir(`fd-relay-${name}-`);
  const repo = join(dir, "repo");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "t@example.test");
  git(repo, "config", "user.name", "t");
  git(repo, "config", "commit.gpgsign", "false");
  git(repo, "remote", "add", "origin", origin);
  writeFileSync(join(repo, "README.md"), "# app\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "inicial");
  const token = `${name}-token-0123456789abcdef0123`;
  const file = join(dir, "config.json");
  writeFileSync(
    file,
    JSON.stringify({
      hostName: name,
      port: 0,
      token,
      dataDir: join(dir, "data"),
      hooks: { port: 0 },
      allowedRoots: [dir],
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
  await client.request("hello", { token, client: "t" });
  await client.data("project.add", { path: repo });
  const created = await client.data<{ sessionId: string }>("session.create", {
    cwd: repo,
    prompt: "oi",
    name,
  });
  const sessionId = created?.sessionId ?? "";
  await until(async () => {
    const list = await client.data<{ sessions: Array<{ id: string; status: string }> }>(
      "session.list",
      {},
    );
    return list?.sessions.find((s) => s.id === sessionId)?.status === "idle";
  });
  const message = async (id: string) =>
    (
      await client.data<{ messages: Array<{ id: string; status: string; reason: string | null }> }>(
        "messages.list",
        {},
      )
    )?.messages.find((m) => m.id === id);
  return { name, url: daemon?.url ?? "", token, client, sessionId, message };
}

/** The app with both hosts added; it relays every 100 ms. */
async function app(...hosts: Array<{ name: string; url: string; token: string }>) {
  const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000, peersSyncMs: 100 });
  cleanups.push(() => store.dispose());
  for (const h of hosts) await store.addHost({ name: h.name, url: h.url, token: h.token });
  await until(async () => store.getState().hosts.every((h) => h.hostInfo != null));
  return store;
}

describe("relay: a message between sessions of two hosts, carried by the app", () => {
  test("a session of host A messages one of host B: B gets it and A is told it was delivered", async () => {
    const a = await host("host-a", "https://github.com/acme/app.git");
    const b = await host("host-b", "https://github.com/acme/app.git");
    await app(a, b);
    const sent = await until(async () => {
      const result = await a.client.data<{ id: string; status: string }>("messages.send", {
        as: { session: a.sessionId },
        to: `host-b/${b.sessionId}`,
        text: "oi, B",
      });
      return result?.status === "queued" ? result : null;
    });
    expect(sent?.status).toBe("queued");
    const id = sent?.id ?? "";
    expect(
      (
        await until(
          async () => (await b.message(id))?.status === "delivered" && (await b.message(id)),
        )
      )?.status,
    ).toBe("delivered");
    expect(
      (
        await until(
          async () => (await a.message(id))?.status === "delivered" && (await a.message(id)),
        )
      )?.status,
    ).toBe("delivered");
  });
});
