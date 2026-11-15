export const BASE = "abc1234def";
/** A fake `git` for planRelated: the merge-base, the changed files and the tracked ones. */
export const fakeGit =
  (changed: string[], tracked: string[], opts: { base?: string | null } = {}) =>
  (args: string[]): string | null => {
    if (args[0] === "merge-base") return opts.base === null ? null : `${BASE}\n`;
    if (args[0] === "diff") return changed.join("\n");
    if (args[0] === "ls-files") return tracked.join("\n");
    return null;
  };
