import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import * as protocol from "@flightdeck/protocol";
import { type FakeCli, type FakeRule, installFakeCli } from "../../../scripts/test/fake-cli.ts";
import { GithubService } from "../src/github/service.ts";
import { Issues } from "../src/issues/issues.ts";
import { type RunningServer, startServer } from "../src/server.ts";
import { newBoard } from "./board-helpers.ts";
import { newManager, poll } from "./helpers.ts";

setDefaultTimeout(30_000);

const TOKEN = "github-protocol-token-0123456789";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const SECRET_TOKEN = "gho_REALSECRETTOKENVALUE0123456789";
const CODE = "ABCD-1234";

const GH_RULES: FakeRule[] = [
  {
    args: ["auth", "status"],
    stdout: `github.com\n  ✓ Logged in to github.com account octocat (keyring)\n  - Token: ${SECRET_TOKEN}\n  - Token scopes: 'repo', 'read:project'\n`,
  },
  {
    args: ["auth", "login"],
    stderr: `! First copy your one-time code: ${CODE}\nOpen https://github.com/login/device\n`,
    delayMs: 30_000,
  },
  { args: ["api", "user"], stdout: "octocat\n" },
  {
    args: ["repo", "list"],
    stdout: JSON.stringify([
      {
        nameWithOwner: "octocat/app",
        description: "an app",
        isPrivate: false,
        url: "https://github.com/octocat/app",
        updatedAt: "2026-10-01T10:00:00Z",
      },
    ]),
  },
  {
    args: ["issue", "list"],
    stdout: JSON.stringify([
      {
        number: 3,
        title: "Third",
        body: "b",
        url: "https://github.com/octocat/app/issues/3",
        author: { login: "octocat" },
        labels: [],
        createdAt: "2026-10-01T10:00:00Z",
        authorAssociation: "OWNER",
      },
    ]),
  },
];

function fakeGh(): FakeCli {
  const cli = installFakeCli("gh", GH_RULES);
  cleanups.push(cli.restore);
  return cli;
}

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
  const ack = await poll(() => acks.find((a) => a.id === "2"), 5000);
  ws.close();
  return ack;
}

function host(withGithub: boolean) {
  const ctx = newBoard();
  cleanups.push(() => ctx.board.stop());
  const logs: string[] = [];
  const service = withGithub
    ? new GithubService({
        roots: [ctx.root],
        board: ctx.board,
        issues: new Issues({ board: ctx.board }),
        startSession: async () => ({ sessionId: "s-1" }),
      })
    : undefined;
  const server = startServer({
    manager: newManager().manager,
    hostName: "h",
    bind: "127.0.0.1",
    port: 0,
    token: TOKEN,
    allowedRoots: [ctx.root],
    board: ctx.board,
    log: (message) => logs.push(message),
    ...(service ? { github: service } : {}),
  });
  cleanups.push(() => server.stop());
  cleanups.push(() => service?.loginCancel());
  return { ...ctx, server, logs };
}

describe("github-protocol: the commands", () => {
  test("payloads: strict objects, a bounded query, a mode that is a card or a session", () => {
    const parse = (type: string, payload: object) =>
      protocol.Command.safeParse({ id: "1", type, payload }).success;
    for (const type of [
      "github.status",
      "github.login.start",
      "github.login.cancel",
      "github.logout",
    ]) {
      expect(parse(type, {})).toBe(true);
      expect(parse(type, { extra: 1 })).toBe(false);
    }
    expect(parse("github.repos", {})).toBe(true);
    expect(parse("github.repos", { query: "flightdeck" })).toBe(true);
    expect(parse("github.repos", { query: "x".repeat(101) })).toBe(false);
    expect(parse("github.issues", { repo: "acme/app" })).toBe(true);
    expect(parse("github.issues", {})).toBe(false);
    expect(parse("github.start", { repo: "acme/app", root: "/r", mode: "card" })).toBe(true);
    expect(
      parse("github.start", { repo: "acme/app", issue: "7", root: "/r", mode: "session" }),
    ).toBe(true);
    expect(parse("github.start", { repo: "acme/app", root: "/r", mode: "other" })).toBe(false);
    expect(parse("github.start", { repo: "acme/app", mode: "card" })).toBe(false);
  });

  test("status, login, repos and issues answer, and host.info announces github", async () => {
    fakeGh();
    const h = host(true);
    const status = await ask(h.server, "github.status", {});
    expect(status?.ok && status.data).toEqual({
      installed: true,
      loggedIn: true,
      login: "octocat",
      scopes: ["repo", "read:project"],
      source: "keyring",
    });
    const login = await ask(h.server, "github.login.start", {});
    expect(login?.ok && login.data).toEqual({ code: CODE, url: "https://github.com/login/device" });
    const cancel = await ask(h.server, "github.login.cancel", {});
    expect(cancel?.ok).toBe(true);
    const repos = await ask(h.server, "github.repos", {});
    expect(repos?.ok && (repos.data as { repos: Array<{ name: string }> }).repos[0]?.name).toBe(
      "octocat/app",
    );
    const issues = await ask(h.server, "github.issues", { repo: "octocat/app" });
    expect(issues?.ok && (issues.data as { issues: Array<{ ref: string }> }).issues[0]?.ref).toBe(
      "github:octocat/app#3",
    );
    const info = await ask(h.server, "host.info", {});
    expect(info?.ok && (info.data as { features: string[] }).features).toContain("github");
  });

  test("a refusal carries its reason", async () => {
    fakeGh();
    const h = host(true);
    const refused = await ask(h.server, "github.issues", { repo: "-R/x" });
    expect(refused && !refused.ok && refused.error.reason).toBe("repo_invalid");
    const outside = await ask(h.server, "github.start", {
      repo: "octocat/app",
      root: "/tmp",
      mode: "card",
    });
    expect(outside && !outside.ok && outside.error.reason).toBe("cwd_outside_roots");
  });

  test("a daemon without the feature refuses them and announces nothing", async () => {
    const h = host(false);
    const status = await ask(h.server, "github.status", {});
    expect(status && !status.ok && status.error.reason).toBe("feature_off");
    const info = await ask(h.server, "host.info", {});
    expect(info?.ok && (info.data as { features: string[] }).features).not.toContain("github");
  });

  test("no token and no one-time code in any log", async () => {
    fakeGh();
    const h = host(true);
    await ask(h.server, "github.status", {});
    await ask(h.server, "github.login.start", {});
    await ask(h.server, "github.login.cancel", {});
    const text = h.logs.join("\n");
    expect(text).not.toContain(SECRET_TOKEN);
    expect(text).not.toContain(CODE);
  });
});
