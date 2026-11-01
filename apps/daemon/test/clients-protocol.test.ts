import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { Project, ProjectListResult } from "@flightdeck/protocol";
import type { BoardOptions } from "../src/board/board.ts";
import { startServer } from "../src/server.ts";
import { git, newBoard } from "./board-helpers.ts";
import { FrameClient } from "./history-helpers.ts";

setDefaultTimeout(20_000);

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanups.splice(0).reverse()) fn();
});

const wire = {
  id: "p1",
  path: "/r",
  name: "r",
  baseBranch: "main",
  prProvider: "none",
  setupScript: null,
  promptTemplate: "",
};

describe("clients-protocol: the project's key on the wire", () => {
  test("a project from a daemon that does not send it still parses, without a key", () => {
    const parsed = Project.safeParse(wire);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.projectKey).toBeUndefined();
  });

  test("a project keeps the key a daemon sends, in a list too", () => {
    const withKey = { ...wire, projectKey: "github.com/acme/api" };
    expect(Project.safeParse(withKey).data?.projectKey).toBe("github.com/acme/api");
    const list = ProjectListResult.safeParse({ projects: [withKey], maxParallelRuns: 2 });
    expect(list.data?.projects[0]?.projectKey).toBe("github.com/acme/api");
  });

  test("a key that is not text is refused", () => {
    expect(Project.safeParse({ ...wire, projectKey: 7 }).success).toBe(false);
  });
});

const TOKEN = "clients-token-0123456789abcdef";

type Keys = NonNullable<BoardOptions["projectKeys"]>;

/** A server over a board whose project keys are `keys`; the board's own folder is the allowed root. */
function serve(keys?: Keys) {
  const ctx = newBoard(keys ? { projectKeys: keys } : {});
  cleanups.push(() => ctx.board.stop());
  const server = startServer({
    manager: ctx.manager,
    board: ctx.board,
    hostName: "h",
    bind: "127.0.0.1",
    port: 0,
    token: TOKEN,
    allowedRoots: [ctx.root],
  });
  cleanups.push(() => server.stop());
  return { ...ctx, server };
}

async function connect(url: string): Promise<FrameClient> {
  const client = new FrameClient(url);
  cleanups.push(() => client.close());
  await client.request("hello", { token: TOKEN, client: "t" });
  return client;
}

interface Wired {
  id: string;
  path: string;
  projectKey?: string;
}

describe("clients-protocol: the daemon fills it", () => {
  test("project.add, project.update and project.list carry the key, with no synchronous git on the way", async () => {
    const keys: Keys = {
      keyFor: () => {
        throw new Error("a synchronous git spawn on a request path");
      },
      resolve: async (path) => `remote-of:${path}`,
    };
    const { server, repo } = serve(keys);
    const client = await connect(server.url);
    const added = await client.data<Wired>("project.add", { path: repo });
    expect(added?.projectKey).toBe(`remote-of:${added?.path}`);
    const updated = await client.data<Wired>("project.update", {
      projectId: added?.id,
      name: "renamed",
    });
    expect(updated?.projectKey).toBe(`remote-of:${added?.path}`);
    const listed = await client.data<{ projects: Wired[] }>("project.list", {});
    expect(listed?.projects.map((p) => p.projectKey)).toEqual([`remote-of:${added?.path}`]);
  });

  test("the keys of a list are asked together, not one after the other", async () => {
    let inFlight = 0;
    let most = 0;
    const keys: Keys = {
      keyFor: () => "unused",
      resolve: async (path) => {
        most = Math.max(most, ++inFlight);
        await Bun.sleep(20);
        inFlight--;
        return `remote-of:${path}`;
      },
    };
    const { server, repo, root } = serve(keys);
    const second = join(root, "second");
    mkdirSync(second);
    git(second, "init", "-q", "-b", "main");
    const client = await connect(server.url);
    await client.data("project.add", { path: repo });
    await client.data("project.add", { path: second, baseBranch: "main" });
    most = 0;
    const listed = await client.data<{ projects: Wired[] }>("project.list", {});
    expect(listed?.projects).toHaveLength(2);
    expect(most).toBe(2);
  });

  test("without the project keys of the central the field is left out, not guessed from the folder", async () => {
    for (const keys of [undefined, { keyFor: () => "unused" }]) {
      const { server, repo } = serve(keys);
      const client = await connect(server.url);
      const added = await client.data<Wired>("project.add", { path: repo });
      expect(added && "projectKey" in added).toBe(false);
      const listed = await client.data<{ projects: Wired[] }>("project.list", {});
      expect(listed?.projects[0] && "projectKey" in listed.projects[0]).toBe(false);
    }
  });
});
