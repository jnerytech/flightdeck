import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCli } from "../../src/main.ts";
import { cardWhen } from "../support/board-helpers.ts";
import { installFakeClaude } from "../support/fake-claude.ts";
import { boardSetup, cleanups, teardown, terminalHost } from "./subagent-setup.ts";

setDefaultTimeout(40_000);
afterEach(teardown);

describe("personas-subagente: o interruptor do projeto", () => {
  test("o padrão é all: o pacote e as do projeto; project só as do projeto; none nenhuma", async () => {
    const { board, personas, repo, project, addPersona } = boardSetup();
    const { id } = await project;
    expect(board.getProject(id).personaSubagents).toBe("all");
    await addPersona("do-projeto");
    const names = async () =>
      Object.keys((await personas.subagents({ projectPath: repo })).agents).sort();
    expect(await names()).toHaveLength(15);
    expect(await names()).toContain("persona-do-projeto");
    board.updateProject(id, { personaSubagents: "project" });
    expect(board.getProject(id).personaSubagents).toBe("project");
    expect(await names()).toEqual(["persona-do-projeto"]);
    // The versioned ones without trust are still reported, so the person knows why.
    writeFileSync(
      join(repo, ".flightdeck", "personas", "sem-confianca.md"),
      "---\nid: sem-confianca\nname: X\ndescription: d\n---\nCorpo.\n",
    );
    expect((await personas.subagents({ projectPath: repo })).untrusted).toEqual(["sem-confianca"]);
    board.updateProject(id, { personaSubagents: "none" });
    expect(await personas.subagents({ projectPath: repo })).toEqual({ agents: {}, untrusted: [] });
    board.updateProject(id, { personaSubagents: "all" });
    expect(await names()).toHaveLength(15);
  });

  test("só all, project e none; a pasta que não é de projeto nenhum fica no padrão", async () => {
    const { board, personas, project, root } = boardSetup();
    const { id } = await project;
    let failure = "ok";
    try {
      board.updateProject(id, { personaSubagents: "tudo" as never });
    } catch (error) {
      failure = (error as { code?: string }).code ?? "sem código";
    }
    expect(failure).toBe("bad_request");
    expect(board.getProject(id).personaSubagents).toBe("all");
    expect(Object.keys((await personas.subagents({ projectPath: root })).agents)).toHaveLength(14);
  });

  test("a sessão gerenciada do projeto, e a do card na worktree dele, seguem o interruptor", async () => {
    const { board, start, manager, runtime, repo, project, addPersona } = boardSetup();
    const { id } = await project;
    await addPersona("do-projeto");
    await start({ cwd: repo, prompt: "oi" });
    expect(Object.keys(runtime.starts[0]?.agents ?? {})).toHaveLength(15);
    board.updateProject(id, { personaSubagents: "none" });
    await start({ cwd: repo, prompt: "oi" });
    expect(runtime.starts[1]?.agents).toBeUndefined();
    // A card runs in a worktree of its own, which still belongs to the project.
    const card = board.createCard(id, { title: "Tarefa", description: "faça" });
    await board.startCard(card.id);
    const running = await cardWhen(board, card.id, (c) => c.sessionId !== null);
    expect(running?.worktreePath).not.toBe(repo);
    expect(runtime.starts.at(-1)?.agents).toBeUndefined();
    board.updateProject(id, { personaSubagents: "project" });
    const worktree = running?.worktreePath ?? repo;
    await start({ cwd: worktree, prompt: "oi" });
    expect(Object.keys(runtime.starts.at(-1)?.agents ?? {})).toEqual(["persona-do-projeto"]);
    // The trust given to the project holds for its worktrees: the file there is the same one.
    const { sessionId } = await start({
      cwd: worktree,
      prompt: "oi",
      persona: { id: "do-projeto" },
    });
    expect(manager.get(sessionId).persona).toMatchObject({ id: "do-projeto" });
  });

  test("o --agents do wrapper também: sem arquivo com none, só as do projeto com project", async () => {
    const { board, personas, root, repo, project, addPersona } = boardSetup();
    const { id } = await project;
    await addPersona("do-projeto");
    const host = await terminalHost(personas, root);
    const fake = installFakeClaude([{ do: "exit", code: 0 }]);
    cleanups.push(fake.restore);
    const run = async () => {
      // Print mode: the agents travel in a file, which a Windows claude.cmd shim can take.
      await runCli(["claude", "-p", "oi"], {
        env: { ...process.env, FLIGHTDECK_CONFIG: host.file },
        log: { log: () => {}, error: () => {} },
        exit: () => {},
        onSignal: () => {},
        selfCommand: [process.execPath, "run", join(import.meta.dir, "../../src/bin.ts")],
        cwd: repo,
      });
      return fake
        .events()
        .filter((e) => e.type === "start")
        .at(-1) as unknown as {
        args: string[];
        agents: Record<string, unknown> | null;
      };
    };
    board.updateProject(id, { personaSubagents: "project" });
    expect(Object.keys((await run()).agents ?? {})).toEqual(["persona-do-projeto"]);
    board.updateProject(id, { personaSubagents: "none" });
    const none = await run();
    expect(none.args).not.toContain("--agents");
    expect(none.agents).toBeNull();
  });
});
