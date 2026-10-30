import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { type SnapshotRow, Snapshots } from "../src/checkpoints/snapshots.ts";
import { withTurnUuids } from "../src/checkpoints/turn-uuid.ts";
import { HistoryIndexer } from "../src/history/indexer.ts";
import { startServer } from "../src/server.ts";
import { EventStore } from "../src/store/event-store.ts";
import { gitRepo } from "./board-helpers.ts";
import { newManager } from "./helpers.ts";
import {
  assistantLine,
  FrameClient,
  projectsRoot,
  userLine,
  writeTranscript,
} from "./history-helpers.ts";

const TOKEN = "turn-uuid-token-0123456789abcdef";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const row = (n: number, kind: string, prompt: string | null, turnUuid: string | null = null) =>
  ({
    claudeSessionId: "s1",
    n,
    ref: "r",
    tree: "t",
    kind,
    turnUuid,
    prompt,
    createdAt: "2026-11-03T10:00:00.000Z",
    repo: "/r",
  }) satisfies SnapshotRow;

const said = (...texts: string[]) => texts.map((text, i) => ({ uuid: `u${i + 1}`, text }));

describe("bifurcar-terminal", () => {
  test("encontrou: o prompt de um turno do terminal casa com a mensagem do usuário no transcript", () => {
    const rows = [row(1, "before", "arrume o teste"), row(2, "after", null)];
    const found = withTurnUuids(rows, said("outra coisa", "arrume o teste"));
    expect(found.map((r) => r.turnUuid)).toEqual(["u2", null]);
  });

  test("o mesmo prompt várias vezes casa na ordem em que foi dito", () => {
    const rows = [row(1, "before", "continue"), row(3, "before", "continue")];
    const found = withTurnUuids(rows, said("continue", "no meio", "continue"));
    expect(found.map((r) => r.turnUuid)).toEqual(["u1", "u3"]);
  });

  test("ambíguo: mais turnos do que mensagens iguais, ou o contrário, não escolhe nenhuma", () => {
    const twoTurns = [row(1, "before", "ok"), row(3, "before", "ok")];
    expect(withTurnUuids(twoTurns, said("ok")).map((r) => r.turnUuid)).toEqual([null, null]);
    const twoMessages = [row(1, "before", "ok")];
    expect(withTurnUuids(twoMessages, said("ok", "ok")).map((r) => r.turnUuid)).toEqual([null]);
  });

  test("ausente: sem prompt, ou sem a mensagem no transcript, fica sem uuid; o que já tem uuid não muda", () => {
    const rows = [
      row(1, "before", null),
      row(3, "before", "ainda não está no transcript"),
      row(5, "before", "do SDK", "uuid-do-sdk"),
    ];
    expect(withTurnUuids(rows, said("do SDK", "outra")).map((r) => r.turnUuid)).toEqual([
      null,
      null,
      "uuid-do-sdk",
    ]);
  });

  test("snapshots.list traz o uuid achado no transcript indexado, e null onde não dá para ter certeza", async () => {
    const store = new EventStore(":memory:");
    cleanups.push(() => store.close());
    const snapshots = new Snapshots({ db: store.db });
    const { repo } = gitRepo();
    const root = projectsRoot();
    const history = new HistoryIndexer({ db: store.db, roots: [root] });
    const take = async (kind: "before" | "after", prompt?: string) => {
      await snapshots.take({
        cwd: repo,
        claudeSessionId: "s1",
        kind,
        ...(prompt ? { prompt } : {}),
      });
    };
    await take("before", "arrume o teste");
    await take("after");
    await take("before", "continue");
    await take("before", "continue");
    await take("before", "ninguém escreveu isto");
    writeTranscript(root, "p", "s1", [
      userLine({ uuid: "u-arrume", text: "arrume o teste", cwd: repo }),
      assistantLine({ uuid: "a1", text: "feito", cwd: repo }),
      userLine({ uuid: "u-cont-1", text: "continue", cwd: repo }),
      userLine({ uuid: "u-cont-2", text: "continue", cwd: repo }),
    ]);
    history.scan();

    const { manager } = newManager();
    const server = startServer({
      manager,
      snapshots,
      history,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [join(repo, "..")],
    });
    cleanups.push(() => server.stop());
    const client = new FrameClient(server.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    const listed = await client.data<{ snapshots: Array<{ n: number; turnUuid: string | null }> }>(
      "snapshots.list",
      { claudeSessionId: "s1" },
    );
    expect(listed?.snapshots.map((s) => [s.n, s.turnUuid])).toEqual([
      [1, "u-arrume"],
      [2, null],
      [3, "u-cont-1"],
      [4, "u-cont-2"],
      [5, null],
    ]);
  });
});
