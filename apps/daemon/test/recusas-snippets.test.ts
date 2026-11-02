import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FlightdeckError } from "../src/errors.ts";
import { SecretScanner } from "../src/snippets/model.ts";
import { Snippets } from "../src/snippets/store.ts";
import { SnippetUse } from "../src/snippets/use.ts";
import { EventStore } from "../src/store/event-store.ts";
import { newManager, workspace } from "./helpers.ts";

async function refused(call: () => unknown) {
  try {
    await call();
  } catch (error) {
    expect(error).toBeInstanceOf(FlightdeckError);
    const { code, reason, params, message } = error as FlightdeckError;
    expect(message).not.toMatch(/[ãõçáéíóú]/);
    return { code, reason, params };
  }
  throw new Error("it did not refuse");
}

const PROMPT = { name: "revisar", type: "prompt" as const, text: "Revise {{file}}." };

function setup() {
  const { root, project } = workspace();
  const db = new EventStore(":memory:").db;
  const snippets = new Snippets({ db, allowedRoots: [root], scanner: new SecretScanner() });
  const writeFile = (text: string) => {
    mkdirSync(join(project, ".flightdeck"), { recursive: true });
    writeFileSync(join(project, ".flightdeck", "snippets.yaml"), text);
  };
  return { root, project, snippets, writeFile };
}

describe("recusas-snippets: the snippet store says why", () => {
  test("scope, missing, repeated and moved snippets", async () => {
    const { snippets, project } = setup();
    expect((await refused(() => snippets.save({ scope: "project", ...PROMPT }))).reason).toBe(
      "snippet_project_path",
    );
    expect((await refused(() => snippets.get("nada"))).reason).toBe("not_found");
    expect((await refused(() => snippets.find("nada"))).reason).toBe("not_found");
    const saved = snippets.save({ scope: "host", ...PROMPT });
    expect(await refused(() => snippets.save({ scope: "host", ...PROMPT }))).toMatchObject({
      reason: "name_taken",
      params: { name: "revisar" },
    });
    expect(
      (
        await refused(() =>
          snippets.save({ id: saved.id, scope: "project", projectPath: project, ...PROMPT }),
        )
      ).reason,
    ).toBe("snippet_scope_fixed");
    const inFile = snippets.save({
      scope: "project",
      projectPath: project,
      target: "file",
      ...PROMPT,
    });
    expect(
      (
        await refused(() =>
          snippets.save({
            id: inFile.id,
            scope: "project",
            projectPath: project,
            target: "daemon",
            ...PROMPT,
          }),
        )
      ).reason,
    ).toBe("snippet_place_fixed");
  });

  test("the project's file: missing, changed since shown, with errors", async () => {
    const { snippets, project, writeFile } = setup();
    expect((await refused(() => snippets.trust(project, "h"))).reason).toBe("snippet_file_missing");
    writeFile('- name: a\n  type: prompt\n  text: "oi"\n');
    expect((await refused(() => snippets.trust(project, "hash-velho"))).reason).toBe(
      "snippet_file_changed",
    );
    writeFile("- name: [\n");
    expect(
      (
        await refused(() =>
          snippets.save({ scope: "project", projectPath: project, target: "file", ...PROMPT }),
        )
      ).reason,
    ).toBe("snippet_file_errors");
  });
});

describe("recusas-snippets: using one says why", () => {
  function usage(withTerminals = false) {
    const ctx = setup();
    const { manager } = newManager();
    const terminals = withTerminals
      ? { write: () => {}, open: () => ({ terminalId: "t" }) }
      : undefined;
    const use = new SnippetUse({
      snippets: ctx.snippets,
      manager,
      ...(terminals ? { terminals } : {}),
    } as never);
    const prompt = ctx.snippets.save({
      scope: "host",
      name: "plain",
      type: "prompt",
      text: "Revise tudo.",
    });
    const command = ctx.snippets.save({ scope: "host", name: "rodar", type: "command", run: "ls" });
    return { ...ctx, use, prompt, command };
  }

  test("an action that does not fit the kind of snippet", async () => {
    const { use, prompt, command } = usage();
    expect((await refused(() => use.use({ id: command.id, action: "send" } as never))).reason).toBe(
      "snippet_is_command",
    );
    expect((await refused(() => use.use({ id: prompt.id, action: "paste" } as never))).reason).toBe(
      "snippet_is_prompt",
    );
  });

  test("terminals and targets", async () => {
    const { use, prompt, command } = usage();
    expect(
      (await refused(() => use.use({ id: command.id, action: "paste", terminalId: "t" } as never)))
        .reason,
    ).toBe("terminals_off");
    expect((await refused(() => use.use({ id: prompt.id, action: "send" } as never))).reason).toBe(
      "session_target_needed",
    );
    expect(
      (
        await refused(() =>
          use.use({
            id: prompt.id,
            action: "send",
            claudeSessionId: "nada",
            values: { file: "a" },
          } as never),
        )
      ).reason,
    ).toBe("session_not_found");
    const withT = usage(true);
    expect(
      (await refused(() => withT.use.use({ id: withT.command.id, action: "paste" } as never)))
        .reason,
    ).toBe("snippet_terminal_needed");
    expect(
      (await refused(() => withT.use.use({ id: withT.command.id, action: "run" } as never))).reason,
    ).toBe("snippet_cwd_needed");
  });
});
