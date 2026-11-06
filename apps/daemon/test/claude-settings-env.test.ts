import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeSettingsEnv } from "../src/terminal/claude-settings-env.ts";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function settingsFile(text: string | null): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "fd-claude-env-"));
  dirs.push(dir);
  const file = join(dir, "settings.json");
  if (text !== null) await writeFile(file, text);
  return file;
}

describe("claude-settings-env: the env block of Claude Code's settings (issue #486)", () => {
  test("its string values are read", async () => {
    const file = await settingsFile(
      JSON.stringify({ env: { CLAUDE_CODE_SCROLL_SPEED: "5", N: 2 }, theme: "dark" }),
    );
    expect(await claudeSettingsEnv(file)).toEqual({ CLAUDE_CODE_SCROLL_SPEED: "5", N: "2" });
  });

  test("a missing file, broken JSON, or no env block read as nothing set", async () => {
    const results = await Promise.all([
      claudeSettingsEnv(await settingsFile(null)),
      claudeSettingsEnv(await settingsFile("{ not json")),
      claudeSettingsEnv(await settingsFile(JSON.stringify({ theme: "dark" }))),
      claudeSettingsEnv(await settingsFile(JSON.stringify({ env: ["x"] }))),
    ]);
    expect(results).toEqual([{}, {}, {}, {}]);
  });
});
