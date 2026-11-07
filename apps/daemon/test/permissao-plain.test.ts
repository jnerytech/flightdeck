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

describe("permissao-plain: the summary lists the request with its plain wording (issue #88)", () => {
  test("Given an announced request, Then the session's pending list carries the same plain as the event", async () => {
    const { manager, store, project } = newManager();
    const { sessionId } = await manager.create({ cwd: project, prompt: "[tool]" });
    const pending = await waitFor(
      () =>
        manager.pendingPermissions(sessionId).length > 0
          ? manager.pendingPermissions(sessionId)
          : null,
      { label: "the pending request" },
    );
    const event = (
      store.db
        .query("SELECT payload FROM events WHERE session_id = ? ORDER BY seq")
        .all(sessionId) as Array<{ payload: string }>
    )
      .map((row) => JSON.parse(row.payload) as { type: string; plain?: PlainInfo })
      .find((e) => e.type === "permission.requested");
    expect(pending[0]?.plain).toEqual(event?.plain);
    expect(pending[0]?.plain?.sentence.en).toBe(`Create the file fake.txt in ${basename(project)}`);
  });
});

describe("permissao-plain: the fake runtime can raise a vault request (issue #88)", () => {
  test("Given [vault], Then the session waits on a request that needs full access, and its wording never shows the command", async () => {
    const { manager, project } = newManager();
    const { sessionId } = await manager.create({ cwd: project, prompt: "[vault]" });
    await waitFor(() => (manager.get(sessionId).status === "running" ? null : true), {
      label: "the first turn to stop",
    });
    const pending = manager.pendingPermissions(sessionId);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.plain?.outcome).toBe("needs_full_access");
    expect(JSON.stringify(pending[0]?.plain)).not.toContain("vault get");
  });
});
