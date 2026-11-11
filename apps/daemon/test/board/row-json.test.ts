import { describe, expect, test } from "bun:test";
import { newBoard } from "../support/board-helpers.ts";

/** A JSON column the daemon wrote and a later version no longer reads: the card still opens. */
describe("row-json: a card row whose JSON columns do not fit", () => {
  test("notice params, variant and auto start that are not their shape read as absent", async () => {
    const { board, store, repo } = newBoard();
    const project = await board.addProject({ path: repo });
    const card = board.createCard(project.id, { title: "Odd", description: "d" });
    store.db
      .query("UPDATE cards SET notice_params = ?, variant = ?, auto_start = ? WHERE id = ?")
      .run('{"n":[1]}', '{"label":3}', "{not json", card.id);
    const read = board.getCard(card.id);
    expect([read.noticeParams, read.variant, read.autoStart]).toEqual([null, null, null]);
  });

  test("a well-formed notice params, variant and auto start are kept", async () => {
    const { board, store, repo } = newBoard();
    const project = await board.addProject({ path: repo });
    const card = board.createCard(project.id, { title: "Fine", description: "d" });
    store.db
      .query("UPDATE cards SET notice_params = ?, variant = ?, auto_start = ? WHERE id = ?")
      .run(
        '{"n":2,"name":"x"}',
        '{"label":"A","model":null,"effort":"high"}',
        '{"workflow":"build"}',
        card.id,
      );
    const read = board.getCard(card.id);
    expect(read.noticeParams).toEqual({ n: 2, name: "x" });
    expect(read.variant).toEqual({ label: "A", model: null, effort: "high" });
    expect(read.autoStart).toEqual({ workflow: "build" });
  });

  test("a project's per-column personas and contracts that do not fit read as empty", async () => {
    const { board, store, repo } = newBoard();
    const project = await board.addProject({ path: repo });
    store.db
      .query("UPDATE projects SET persona_by_column = ?, contract_by_column = ? WHERE id = ?")
      .run('["x"]', "{nope", project.id);
    const read = board.listProjects().find((p) => p.id === project.id);
    expect([read?.personaByColumn, read?.contractByColumn]).toEqual([{}, {}]);
  });

  test("a per-column map keeps the columns it knows and drops a key that is no column", async () => {
    const { board, store, repo } = newBoard();
    const project = await board.addProject({ path: repo });
    store.db
      .query("UPDATE projects SET persona_by_column = ? WHERE id = ?")
      .run('{"review":"p1","legacy_col":"p2"}', project.id);
    const read = board.listProjects().find((p) => p.id === project.id);
    expect(read?.personaByColumn).toEqual({ review: "p1" });
  });
});
