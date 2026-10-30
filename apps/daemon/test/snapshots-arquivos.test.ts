import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Snapshots } from "../src/checkpoints/snapshots.ts";
import { startServer } from "../src/server.ts";
import { EventStore } from "../src/store/event-store.ts";
import { git, gitRepo } from "./board-helpers.ts";
import { newManager } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

const TOKEN = "files-token-0123456789abcdef";
const sha = (path: string) =>
  new Bun.CryptoHasher("sha256").update(readFileSync(path)).digest("hex");

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** Two turns in a repo: the first edits README, the second creates a file and deletes another. */
async function twoTurns() {
  const store = new EventStore(":memory:");
  cleanups.push(() => store.close());
  const snapshots = new Snapshots({ db: store.db });
  const { repo } = gitRepo();
  writeFileSync(join(repo, "apagar.txt"), "vai sumir\n");
  git(repo, "add", "apagar.txt");
  git(repo, "commit", "-q", "-m", "apagar");
  const take = async (kind: "before" | "after") => {
    const result = await snapshots.take({ cwd: repo, claudeSessionId: "s1", kind });
    return "row" in result ? result.row.n : -1;
  };
  const first = await take("before");
  writeFileSync(join(repo, "README.md"), "# repo\nlinha nova\n");
  await take("after");
  const second = await take("before");
  writeFileSync(join(repo, "novo.txt"), "um\ndois\n");
  rmSync(join(repo, "apagar.txt"));
  await take("after");
  const quiet = await take("before");
  await take("after");
  return { snapshots, repo, first, second, quiet };
}

describe("snapshots-arquivos", () => {
  test("os arquivos de um turno são os que ele mudou, não os de todos os turnos depois", async () => {
    const { snapshots, first, second } = await twoTurns();
    expect(await snapshots.files("s1", first)).toEqual({
      files: [{ path: "README.md", change: "modified" }],
      insertions: 1,
      deletions: 0,
    });
    expect(await snapshots.files("s1", second)).toEqual({
      files: [
        { path: "apagar.txt", change: "deleted" },
        { path: "novo.txt", change: "created" },
      ],
      insertions: 2,
      deletions: 1,
    });
  });

  test("um turno que não mudou nada, ou que ainda não acabou, não tem arquivos", async () => {
    const { snapshots, repo, quiet } = await twoTurns();
    expect(await snapshots.files("s1", quiet)).toEqual({ files: [], insertions: 0, deletions: 0 });
    writeFileSync(join(repo, "outro.txt"), "x\n");
    const open = await snapshots.take({ cwd: repo, claudeSessionId: "s1", kind: "before" });
    const n = "row" in open ? open.row.n : -1;
    expect(await snapshots.files("s1", n)).toEqual({ files: [], insertions: 0, deletions: 0 });
  });

  test("um turno que não existe é not_found, e o índice e os arquivos do usuário ficam como estão", async () => {
    const { snapshots, repo, first } = await twoTurns();
    const before = {
      status: git(repo, "status", "--porcelain", "--untracked-files=all"),
      index: sha(join(repo, ".git", "index")),
    };
    await snapshots.files("s1", first);
    expect({
      status: git(repo, "status", "--porcelain", "--untracked-files=all"),
      index: sha(join(repo, ".git", "index")),
    }).toEqual(before);
    let code = "ok";
    try {
      await snapshots.files("s1", 999);
    } catch (error) {
      code = (error as { code?: string }).code ?? "erro";
    }
    expect(code).toBe("not_found");
  });

  test("protocolo: snapshots.files responde com os arquivos do turno", async () => {
    const { snapshots, second } = await twoTurns();
    const { manager } = newManager();
    const server = startServer({
      manager,
      snapshots,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [],
    });
    cleanups.push(() => server.stop());
    const client = new FrameClient(server.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    const result = await client.data<{ files: Array<{ path: string }>; insertions: number }>(
      "snapshots.files",
      { claudeSessionId: "s1", n: second },
    );
    expect(result?.files.map((f) => f.path)).toEqual(["apagar.txt", "novo.txt"]);
    expect(result?.insertions).toBe(2);
    expect(
      await client.request("snapshots.files", { claudeSessionId: "s1", n: 999 }),
    ).toMatchObject({ ok: false, error: { code: "not_found" } });
  });

  test("protocolo: um daemon sem snapshots responde invalid_state", async () => {
    const { manager } = newManager();
    const server = startServer({
      manager,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [],
    });
    cleanups.push(() => server.stop());
    const client = new FrameClient(server.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    expect(await client.request("snapshots.files", { claudeSessionId: "s1", n: 1 })).toMatchObject({
      ok: false,
      error: { code: "invalid_state" },
    });
  });
});
