// Body of every fake CLI (see fake-cli.ts): `bun fake-cli-main.ts <stateDir> ...args`. Answers
// through answerFake, the same as the fake's in-process `run`, then acts out the rule's holds.
import { answerFake } from "./fake-cli.ts";

const [stateDir = "", ...args] = process.argv.slice(2);
const { code, stdout, stderr, rule } = answerFake(stateDir, args, process.cwd());
if (stdout) process.stdout.write(stdout);
if (stderr) process.stderr.write(stderr);
if (rule?.holdPipesMs) {
  const hold = `setTimeout(() => {}, ${Number(rule.holdPipesMs)})`;
  Bun.spawn([process.execPath, "-e", hold], {
    stdout: "inherit",
    stderr: "inherit",
    stdin: "ignore",
  }).unref();
}
if (rule?.delayMs) await Bun.sleep(rule.delayMs);
process.exit(code);
