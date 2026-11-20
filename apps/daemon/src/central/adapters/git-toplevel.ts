/**
 * The top folder of the git repository a folder is in (#3432): what a launched session is named
 * after. `null` when the folder is in no repository or git is not installed.
 */
import { whichOnPath } from "../../kernel/index.ts";

/** The variables that choose which repository git looks at. */
const REPO_SELECTORS = new Set([
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY",
]);

/** A stalled mount or a locked repository must not hold the launch of claude for long. */
const GIT_TIMEOUT_MS = 3000;

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
    timeout: GIT_TIMEOUT_MS,
  });
  const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  const top = stdout.trim();
  return code === 0 && top !== "" ? top : null;
}
