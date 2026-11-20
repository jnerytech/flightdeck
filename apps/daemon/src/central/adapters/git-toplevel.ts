/**
 * The top folder of the git repository a folder is in (#3432): what a launched session is named
 * after. `null` when the folder is in no repository or git is not installed.
 */
import { whichOnPath } from "../../kernel/index.ts";

export async function gitToplevel(cwd: string): Promise<string | null> {
  const git = whichOnPath("git");
  if (!git) return null;
  // A GIT_DIR or GIT_WORK_TREE of the caller (a hook, a worktree session) would answer for another folder.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
  const proc = Bun.spawn([git, "-C", cwd, "rev-parse", "--show-toplevel"], {
    env,
    stdout: "pipe",
    stderr: "ignore",
    stdin: "ignore",
  });
  const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  const top = stdout.trim();
  return code === 0 && top !== "" ? top : null;
}
