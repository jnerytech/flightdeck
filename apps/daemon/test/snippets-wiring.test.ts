import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { SecretScanner } from "@flightdeck/protocol";
import { createSnippets } from "../src/snippets/wiring.ts";
import { EventStore } from "../src/store/event-store.ts";
import { tempDir } from "./helpers.ts";

/**
 * The snippets as main.ts builds them (#1593): the host's scanner, which knows the vault's values,
 * judges both what is saved and what the shells' history offers, and the allowed roots bound them.
 */
const VAULT = "vault-value-snippets-0123";

function wired() {
  const home = tempDir("fd-snippets-wiring-home-");
  const root = tempDir("fd-snippets-wiring-root-");
  const built = createSnippets({
    db: new EventStore(":memory:").db,
    config: { allowedRoots: [root] },
    scanner: new SecretScanner(() => [VAULT]),
    use: { manager: { send: async () => {} } as never, exec: (async () => ({})) as never },
    history: { home, appData: undefined, platform: "linux" },
  });
  return { built, home };
}

async function outcome(run: Promise<unknown>): Promise<string> {
  try {
    await run;
    return "ok";
  } catch (error) {
    const e = error as { reason?: string; code?: string };
    return e.reason ?? e.code ?? String(error);
  }
}

describe("snippets-wiring: the host's snippets, judged by its scanner and bound by its roots (#1593)", () => {
  test("a snippet holding a vault value is not saved", async () => {
    const { built } = wired();
    const save = built.snippets.save({
      scope: "host",
      name: "deploy",
      type: "command",
      run: `echo ${VAULT}`,
    } as never);
    expect(await outcome(save)).toBe("secret");
  });

  test("a history line holding a vault value is hidden in the import, the others offered", async () => {
    const { built, home } = wired();
    writeFileSync(join(home, ".bash_history"), `docker compose up --build api\necho ${VAULT}\n`);
    const { candidates } = await built.snippetHistory.preview({});
    const shown = candidates.map((c) => ({ command: c.command, hidden: c.hidden }));
    expect(shown).toContainEqual({ command: "docker compose up --build api", hidden: false });
    expect(shown).toContainEqual({ command: null, hidden: true });
  });

  test("a project snippet outside the allowed roots is refused", async () => {
    const { built } = wired();
    const save = built.snippets.save({
      scope: "project",
      projectPath: tempDir("fd-snippets-wiring-outside-"),
      name: "build",
      type: "command",
      run: "bun run build",
    } as never);
    expect(await outcome(save)).not.toBe("ok");
  });
});
