import { describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { whichOnPath } from "../../src/kernel/which.ts";
import { agentSetupOptions, createAgentSetup } from "../../src/plugins/wiring.ts";
import { BUILTIN_TEMPLATES } from "../../src/templates/index.ts";
import { tempDir } from "../support/helpers.ts";

/**
 * What a session starts with, as main.ts builds it (issue #1593): Claude Code's plugins through the
 * configured `claude`, and the pins, decision logs, tasks and templates kept in the data folder.
 */

describe("agent-setup-wiring: the agent setup the daemon builds (#1593)", () => {
  test("the plugins run the configured claude, else the one on the PATH", () => {
    const configured = agentSetupOptions({ dataDir: "/d", claudePath: "/opt/claude" });
    const fromPath = agentSetupOptions({ dataDir: "/d", claudePath: undefined });
    expect([configured.executable(), fromPath.executable()]).toEqual([
      "/opt/claude",
      whichOnPath("claude"),
    ]);
  });

  test("the pins, the decision logs, the tasks and the templates live in the data folder", () => {
    const { executable: _, ...paths } = agentSetupOptions({ dataDir: "/d", claudePath: undefined });
    expect(paths).toEqual({
      pinsFile: join("/d", "plugin-pins.json"),
      pluginDecisionsFile: join("/d", "plugin-decisions.jsonl"),
      memoryDecisionsFile: join("/d", "memory-decisions.jsonl"),
      tasksDir: join("/d", "tasks"),
      templatesDir: join("/d", "templates"),
    });
  });

  test("the tasks are kept in the data folder and the templates start with the built-ins", async () => {
    const dataDir = tempDir("agent-setup-");
    try {
      const setup = createAgentSetup({ dataDir, claudePath: undefined });
      const loaded = await setup.templates();
      expect([setup.tasks.opts.dir, loaded.templates.map((t) => t.id)]).toEqual([
        join(dataDir, "tasks"),
        BUILTIN_TEMPLATES.map((t) => t.id),
      ]);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
