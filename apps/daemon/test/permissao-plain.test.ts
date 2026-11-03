import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { PlainInfo } from "@flightdeck/protocol";
import { newManager, waitFor } from "./helpers.ts";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** The `plain` of the permission request a session opens for this prompt. */
async function asked(prompt: string, before?: (project: string) => void) {
  const { manager, store, project } = newManager();
  before?.(project);
  const { sessionId } = await manager.create({ cwd: project, prompt });
  const requested = await waitFor(
    () =>
      (
        store.db
          .query("SELECT payload FROM events WHERE session_id = ? ORDER BY seq")
          .all(sessionId) as Array<{ payload: string }>
      )
        .map((row) => JSON.parse(row.payload) as { type: string; plain?: PlainInfo })
        .find((event) => event.type === "permission.requested"),
    { label: "the permission request" },
  );
  return { plain: requested.plain, project };
}

describe("permissao-plain: the request the host emits carries its plain wording", () => {
  test("Given a file that is not there, When Claude asks to write it, Then the request says create, in both languages", async () => {
    const { plain, project } = await asked("[tool]");
    expect(plain).toMatchObject({ kind: "create", reversible: true, outcome: "ask", hold: false });
    expect(plain?.sentence.en).toBe(`Create the file fake.txt in ${basename(project)}`);
    expect(plain?.sentence["pt-BR"]).toBe(`Criar o arquivo fake.txt em ${basename(project)}`);
  });

  test("Given a file that is already there, When Claude asks to write it, Then the host, which can look, says replace and that it cannot be undone", async () => {
    const { plain } = await asked("[tool]", (project) =>
      writeFileSync(join(project, "fake.txt"), "old"),
    );
    expect(plain).toMatchObject({ kind: "replace", reversible: false });
    expect(plain?.consequence.en).toBe("This cannot be undone.");
  });

  test("Given a command that is not one simple step, Then the request falls back to a step worded by risk, never the command", async () => {
    const { plain } = await asked("[bash]");
    expect(plain?.kind).toBe("run");
    expect(JSON.stringify(plain)).not.toContain("npm");
  });
});
