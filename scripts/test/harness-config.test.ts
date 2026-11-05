import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { realTempDir } from "./temp-dir.ts";

/**
 * The project's Claude Code setup itself (.claude/): a hook path that does not resolve or a
 * frontmatter that does not parse fails silently in Claude Code, so it fails here instead.
 */
const ROOT = resolve(import.meta.dir, "../..");
const settings = JSON.parse(readFileSync(join(ROOT, ".claude/settings.json"), "utf8"));

type Hook = { type: string; command: string; timeout?: number; onFailure?: string };
const hooks: { event: string; hook: Hook }[] = Object.entries(
  settings.hooks as Record<string, { hooks: Hook[] }[]>,
).flatMap(([event, groups]) => groups.flatMap((g) => g.hooks.map((hook) => ({ event, hook }))));

/** The frontmatter of a Markdown file, parsed, or why it does not parse. */
function frontmatter(path: string): Record<string, unknown> | string {
  const block = /^---\n([\s\S]*?)\n---\n/.exec(readFileSync(path, "utf8"))?.[1];
  if (block === undefined) return "no frontmatter";
  try {
    return Bun.YAML.parse(block) as Record<string, unknown>;
  } catch (error) {
    return `does not parse as YAML (${String(error)}); quote a value that holds ": "`;
  }
}

async function runGuard(stdin: string) {
  const proc = Bun.spawn([process.execPath, join(ROOT, ".claude/hooks/guard.ts")], {
    stdin: new Blob([stdin]),
    stdout: "pipe",
    stderr: "pipe",
    // Not a checkout: the guard finds no repository and writes no hook log.
    env: { ...process.env, CLAUDE_PROJECT_DIR: realTempDir("fd-harness-config-") },
  });
  const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
  return { code, stderr };
}

describe("harness-config", () => {
  test("every hook runs a file that exists, with a timeout and failing open", () => {
    expect(hooks.length).toBeGreaterThan(0);
    for (const { event, hook } of hooks) {
      const file = /\$CLAUDE_PROJECT_DIR\/(\.claude\/hooks\/[\w-]+\.ts)/.exec(hook.command)?.[1];
      expect(`${event}: ${file ?? hook.command}`).toBe(`${event}: ${file}`);
      expect(existsSync(join(ROOT, file ?? ""))).toBe(true);
      expect(hook.type).toBe("command");
      expect(hook.timeout ?? 0).toBeGreaterThan(0);
      expect(hook.timeout ?? 999).toBeLessThanOrEqual(30);
      expect(hook.onFailure).toBe("continue");
    }
  });

  test("the deny list keeps the credentials and keys out of reach", () => {
    const deny: string[] = settings.permissions.deny;
    for (const rule of [
      "Read(~/.claude/.credentials.json)",
      "Read(~/.ssh/**)",
      "Read(~/.bash_history)",
    ]) {
      expect(deny).toContain(rule);
    }
  });

  test("the guard entry blocks with exit 2 and a reason, and passes bad input", async () => {
    const blocked = await runGuard('{"tool_name":"Bash","tool_input":{"command":"git add -A"}}');
    expect(blocked.code).toBe(2);
    expect(blocked.stderr).toContain("is blocked");
    expect((await runGuard("not json")).code).toBe(0);
    expect((await runGuard('{"tool_name":"Bash","tool_input":{"command":"ls"}}')).code).toBe(0);
  });

  test("every agent and skill has a frontmatter that parses, with a name and a description", () => {
    const files = [
      ...readdirSync(join(ROOT, ".claude/agents")).map((f) => join(ROOT, ".claude/agents", f)),
      ...readdirSync(join(ROOT, ".claude/skills")).map((d) =>
        join(ROOT, ".claude/skills", d, "SKILL.md"),
      ),
    ];
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const meta = frontmatter(file);
      const shape =
        typeof meta === "string" ? meta : `${typeof meta.name}/${typeof meta.description}`;
      expect(`${file}: ${shape}`).toBe(`${file}: string/string`);
    }
  });
});
