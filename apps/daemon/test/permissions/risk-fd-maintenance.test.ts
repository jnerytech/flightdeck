import { describe, expect, test } from "bun:test";
import { notHigh, wrongReasons } from "../support/permissions-risk-rules.ts";

const PRUNE =
  "deletes the events, permission requests and conversation text of ended sessions beyond the retention policy, which cannot be undone (flightdeckd db prune without --dry-run)";

const RESTORE =
  "replaces the host's whole database with a backup file, so everything recorded since the backup is gone (flightdeckd restore)";

const HIDDEN =
  "runs a flightdeckd command whose name, noun or verb the shell expands before it runs (a variable, a glob, a brace list or an ANSI-C quote), so the line does not say what it does";

describe("risk rules: the maintenance commands from a session's shell (#3756)", () => {
  test("db prune that deletes is high, however the CLI is reached", () => {
    expect(
      wrongReasons([
        ["fd db prune", PRUNE],
        ["flightdeckd --config /tmp/c.json db prune", PRUNE],
        ["fd --json db prune", PRUNE],
        ["bunx flightdeckd db prune", PRUNE],
        ['fd db "prune"', PRUNE],
        ["fd db prune --dry-run=false", PRUNE],
        ["fd db prune --dry-run && fd db prune", PRUNE],
        ['bash -c "fd db prune"', PRUNE],
      ]),
    ).toEqual([]);
  });

  test("restore is high: it swaps the whole database", () => {
    expect(
      wrongReasons([
        ["fd restore backup.db", RESTORE],
        ["flightdeckd restore /tmp/flightdeck-20261030-120000.db --config /tmp/c.json", RESTORE],
        ["bunx flightdeckd restore backup.db", RESTORE],
        ['bash -c "fd restore backup.db"', RESTORE],
      ]),
    ).toEqual([]);
  });

  test("a verb the shell expands could be prune, so it is high", () => {
    expect(wrongReasons([["fd db $V --dry-run", HIDDEN]])).toEqual([]);
  });

  test("the dry run, the status, the backup and the doctor read or copy only, so they stay ordinary", () => {
    expect(
      notHigh([
        "fd db prune --dry-run",
        "fd db prune --dry-run --json",
        "fd db status",
        "fd db status --json",
        "fd backup",
        "fd backup --json --out /tmp/copy.db",
        "fd doctor",
        "fd doctor --json",
        "fd card show restore",
      ]),
    ).toEqual([]);
  });
});
