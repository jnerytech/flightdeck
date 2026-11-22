import { ntfsName } from "./ntfs-name.ts";

/**
 * Whether a path of a repository is something that shapes every session that runs in it, as Claude
 * Code reads it: anything inside a `.claude` folder at any depth (settings that declare hooks and
 * permissions, agents, skills, commands, rules), a `CLAUDE.md` or `CLAUDE.local.md` and a `.mcp.json`. A write
 * there decides what a session does, so it needs what `agentcfg.write` needs. Any separator, any
 * case and the spellings a Windows filesystem folds (trailing dots, a stream, a short name) count, and a leading
 * `./` or an empty step does not matter.
 */
export function isClaudeConfig(path: string): boolean {
  const steps = path
    .split(/[\\/]/)
    .filter((step) => step !== "" && step !== ".")
    .map(ntfsName);
  const name = steps.at(-1);
  return (
    steps.slice(0, -1).includes(".claude") ||
    name === "claude.md" ||
    name === "claude.local.md" ||
    // The project's MCP servers: each is a command the next session starts (`mcp.save` is near only too).
    name === ".mcp.json" ||
    // The 8.3 short name of `CLAUDE.local.md`, which Windows opens as the file itself. A short name
    // made of a hash (`CLAB3F2~1.MD`, once many names collide) is not told apart.
    /^claude~\d+\.md$/.test(name ?? "")
  );
}
