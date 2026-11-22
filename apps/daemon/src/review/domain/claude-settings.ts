import { ntfsName } from "../../kernel/index.ts";

/**
 * Whether a path of a repository is one of Claude Code's settings files (`.claude/settings.json`,
 * `.claude/settings.local.json`): they can declare hooks and permissions, so a write there decides
 * what a session runs. Any separator, any case and the spellings a Windows filesystem folds
 * (trailing dots, a stream) count, and a leading `./` or an empty step does not matter.
 */
export function isClaudeSettings(path: string): boolean {
  const steps = path
    .split(/[\\/]/)
    .filter((step) => step !== "" && step !== ".")
    .map(ntfsName);
  return (
    steps.length === 2 &&
    steps[0] === ".claude" &&
    (steps[1] === "settings.json" || steps[1] === "settings.local.json")
  );
}
