// Body of every fake CLI (see fake-cli.ts): `bun fake-cli-main.ts <stateDir> ...args`. Answers
// through answerFake, the same as the fake's in-process `run`, then acts out the rule's holds.
//
// A fake never outlives its caller (issue #254: 83 orphans once held 11.6 GB). It records its pid
// under <stateDir>/pids (the run's preload kills what is left, reapFakes), stops as soon as the
// process that started it is gone, and never lives past FAKE_MAX_MS.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { answerFake } from "./fake-cli.ts";
import { pidAlive } from "./temp-run.ts";

/** The longest a fake lives, its holds included (FLIGHTDECK_FAKE_MAX_MS overrides it). */
const FAKE_MAX_MS = Number(process.env.FLIGHTDECK_FAKE_MAX_MS) || 60_000;
/** How often a waiting fake looks at its caller. */
const WATCH_MS = 100;

const [stateDir = "", ...args] = process.argv.slice(2);
// The shell shim passes its own parent (exec keeps the shim's pid, so ours is that parent too);
// started some other way, the caller is our parent as we found it.
const startPpid = process.ppid;
const caller = Number(process.env.FLIGHTDECK_FAKE_CALLER) || startPpid;
const pids = join(stateDir, "pids");

const record = (pid: number) => {
  try {
    mkdirSync(pids, { recursive: true });
    writeFileSync(join(pids, String(pid)), "");
  } catch {
    // A fake that cannot record still answers; its deadline and watch still end it.
  }
};
/** Gone: re-parented (to init or a subreaper), or the caller's pid no longer exists. */
const orphaned = () => process.ppid === 1 || process.ppid !== startPpid || !pidAlive(caller);

record(process.pid);
process.on("exit", () => rmSync(join(pids, String(process.pid)), { force: true }));
setTimeout(() => process.exit(124), FAKE_MAX_MS).unref();
setInterval(() => {
  if (orphaned()) process.exit(1);
}, WATCH_MS).unref();
if (orphaned()) process.exit(1);

const { code, stdout, stderr, rule } = answerFake(stateDir, args, process.cwd());
if (stdout) process.stdout.write(stdout);
if (stderr) process.stderr.write(stderr);
if (rule?.holdPipesMs) {
  // The holder outlives this process on purpose (a Windows shim's child keeps the pipes open), so it
  // watches the caller, not us. Its first comment names it for reapFakes' command-line check.
  const holdMs = Math.min(Number(rule.holdPipesMs), FAKE_MAX_MS);
  const hold = `/* fake-cli-main hold */ const c = ${caller}; const alive = () => { try { process.kill(c, 0); return true; } catch (e) { return e.code === "EPERM"; } }; setInterval(() => { if (!alive()) process.exit(0); }, ${WATCH_MS}); setTimeout(() => process.exit(0), ${holdMs});`;
  const holder = Bun.spawn([process.execPath, "-e", hold], {
    stdout: "inherit",
    stderr: "inherit",
    stdin: "ignore",
  });
  record(holder.pid);
  holder.unref();
}
if (rule?.delayMs) await Bun.sleep(rule.delayMs);
process.exit(code);
