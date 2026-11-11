import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { AlertList } from "../src/github/alerts.ts";
import { startServer } from "../src/server.ts";
import { FrameClient } from "./history-helpers.ts";
import { workflowCard } from "./workflow-helpers.ts";

// Real git in a temporary repository: more than the default 5 s.
setDefaultTimeout(20_000);

const TOKEN = "alerts-token-0123456789abcdef0123";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const LIST: AlertList = {
  alerts: [
    {
      id: "dependabot:5",
      kind: "dependabot",
      number: 5,
      severity: "high",
      title: "Prototype pollution in lodash",
      location: "package.json",
      url: "https://github.com/o/r/security/dependabot/5",
      text: "Dependabot alert #5 (high): Prototype pollution in lodash",
    },
  ],
  unavailable: [{ kind: "code-scanning", reason: "unavailable" }],
};

async function serve(alerts?: (cwd: string) => Promise<AlertList>) {
  const ctx = await workflowCard("steps:\n  - id: lint\n    check: fd-lint\n");
  cleanups.push(() => ctx.board.stop());
  const server = startServer({
    manager: ctx.manager,
    board: ctx.board,
    hostName: "h",
    bind: "127.0.0.1",
    port: 0,
    token: TOKEN,
    allowedRoots: [ctx.root],
    ...(alerts ? { alerts } : {}),
  });
  cleanups.push(() => server.stop());
  const client = new FrameClient(server.url);
  cleanups.push(() => client.close());
  await client.request("hello", { token: TOKEN, client: "t" });
  const features = async () =>
    (await client.data<{ features: string[] }>("host.info", {}))?.features ?? [];
  return { client, features, project: ctx.project, repo: ctx.repo };
}

describe("alert.list (issue #79)", () => {
  test("answers with the alerts of the project's own folder, and the host announces the feature", async () => {
    const asked: string[] = [];
    const { client, features, project, repo } = await serve(async (cwd) => {
      asked.push(cwd);
      return LIST;
    });
    expect((await features()).includes("alerts")).toBe(true);
    const result = await client.data<AlertList>("alert.list", { projectId: project.id });
    expect(result).toEqual(LIST);
    expect(asked).toEqual([repo]);
  });

  test("a host without the reader says so, and does not announce it", async () => {
    const { client, features, project } = await serve();
    expect((await features()).includes("alerts")).toBe(false);
    const refused = await client.request("alert.list", { projectId: project.id });
    expect(refused).toMatchObject({
      ok: false,
      error: { code: "invalid_state", reason: "feature_off", params: { feature: "alerts" } },
    });
  });

  test("a project that does not exist is refused with its reason, and nothing is read", async () => {
    let reads = 0;
    const { client } = await serve(async () => {
      reads++;
      return LIST;
    });
    const refused = await client.request("alert.list", { projectId: "nope" });
    expect(refused).toMatchObject({
      ok: false,
      error: { code: "not_found", reason: "project_not_found" },
    });
    expect(reads).toBe(0);
  });
});
