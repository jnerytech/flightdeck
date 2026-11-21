import { isExpanded, runsFlightdeckWords } from "./shell-call.ts";
import { READING_FLAGS } from "./watch-risk.ts";

/** The flags whose next word is their value, and so never a flag of its own (`--config --dry-run`). */
const TAKES_A_VALUE = new Set(["--config", "--host"]);

/**
 * Whether the words ask for a dry run and nothing else that deletes: the `--dry-run` flag as a word of its own, and
 * no word the shell expands, which may be any flag (`--dry-run $X`), nor a flag that is not a reading one
 * (`--dry-run=false`).
 */
function onlyCounts(own: string[]): boolean {
  if (own.some(isExpanded)) return false;
  const flags = own.filter((w, i) => w.startsWith("--") && !TAKES_A_VALUE.has(own[i - 1] ?? ""));
  return (
    flags.includes("--dry-run") && flags.every((w) => w === "--dry-run" || READING_FLAGS.has(w))
  );
}

/**
 * `db prune` without `--dry-run` deletes the events, the permission requests and the transcripts of ended sessions
 * beyond the retention policy, and `restore <file>` replaces the host's whole database with a file (#3756): neither
 * can be undone, and a session has no reason to run either on its own host. The dry run, `db status`, `backup` (a
 * copy) and `doctor` only read or copy, so they stay ordinary. A prune is read by what it is not (a dry run and
 * nothing else), so a flag a later version adds, `--dry-run=false` or a word the shell expands is high too.
 */
export const MAINTENANCE_RULES: Array<{
  when: (prog: string, args: string[]) => boolean;
  reason: (prog: string) => string;
}> = [
  {
    when: (prog, args) =>
      runsFlightdeckWords(
        prog,
        args,
        ([command, action], own) => command === "db" && action === "prune" && !onlyCounts(own),
      ),
    reason: () =>
      "deletes the events, permission requests and conversation text of ended sessions beyond the retention policy, which cannot be undone (flightdeckd db prune without --dry-run)",
  },
  {
    when: (prog, args) => runsFlightdeckWords(prog, args, ([command]) => command === "restore"),
    reason: () =>
      "replaces the host's whole database with a backup file, so everything recorded since the backup is gone (flightdeckd restore)",
  },
];
