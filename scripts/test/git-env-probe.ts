// Run by git-env.test.ts as a fresh process that inherited GIT_DIR: it installs the guard, then
// runs the `git init --bare` that used to re-initialise the repository GIT_DIR names.
import { installGitEnvGuard } from "./git-env.ts";

installGitEnvGuard();
const [folder] = process.argv.slice(2);
if (!folder) throw new Error("usage: git-env-probe.ts <folder>");
const proc = Bun.spawnSync(["git", "init", "-q", "--bare"], { cwd: folder, stderr: "pipe" });
if (proc.exitCode !== 0) throw new Error(proc.stderr.toString());
