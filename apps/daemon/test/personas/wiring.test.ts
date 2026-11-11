import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createPersonas } from "../../src/personas/wiring.ts";
import { SecretScanner } from "../../src/snippets/model.ts";
import { EventStore } from "../../src/store/event-store.ts";
import { tempDir } from "../support/helpers.ts";

/**
 * The personas as main.ts builds them (issue #1593): phase 20's pack is plugged in, a new
 * session reads its persona from the store, and publishing goes through the agent editor given.
 */

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function setup() {
  const store = new EventStore(":memory:");
  const root = tempDir("personas-wiring-");
  const project = join(root, "proj");
  mkdirSync(project);
  cleanups.push(
    () => store.close(),
    () => rmSync(root, { recursive: true, force: true }),
  );
  const written: string[] = [];
  const built = createPersonas({
    db: store.db,
    allowedRoots: [root],
    scanner: new SecretScanner(),
    agents: {
      list: async () => [],
      write: async (_projectPath, item) => {
        written.push(`${item.kind} ${item.origin} ${item.path}`);
        return {} as never;
      },
    },
  });
  return { ...built, project, written };
}

describe("personas-wiring: the personas the daemon builds (#1593)", () => {
  test("a new session opens in a pack persona read from the store", async () => {
    const { prepare, project } = setup();
    const prepared = await prepare({ id: "revisor", language: "en" }, project);
    expect([prepared.persona?.source, prepared.persona?.persona.id]).toEqual(["pack", "revisor"]);
  });

  test("a persona is published through the agent editor given", async () => {
    const { personaStore, project, written } = setup();
    await personaStore.publishAgent({ id: "revisor", projectPath: project, confirm: true });
    expect(written).toEqual(["agent project .claude/agents/persona-revisor.md"]);
  });
});
