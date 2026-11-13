#!/usr/bin/env bun
/**
 * `bun run sonar-left [-- --severity CRITICAL,MAJOR] [--path <prefix>]` (issue #1477): SonarCloud's
 * open findings on main, `STALE?` where the file changed on main since Sonar's last analysed
 * commit. The logic is in lib/sonar/left.ts. The API is public: no token is read.
 */
import { runCommand } from "../apps/daemon/src/kernel/command.ts";
import { sonarLeft } from "./lib/sonar/left.ts";

const git = async (args: string[]) => {
  const ran = await runCommand(["git", ...args], process.cwd(), undefined, 30_000);
  return { code: ran.timedOut ? 124 : ran.code, stdout: ran.stdout };
};
process.exit(
  await sonarLeft(process.argv.slice(2), {
    fetch: (url) => fetch(url, { signal: AbortSignal.timeout(30_000) }),
    git,
    log: (line) => console.log(line), // NOSONAR: lib/sonar/left.ts passes API and git text through oneLine (no control or bidi characters) and checks the analysed revision is hex
  }),
);
