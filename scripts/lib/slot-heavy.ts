/**
 * What the slot-heavy guard (scripts/lib/claude-hooks.ts) and coverage:funcs share (#674): the
 * limit, the reason check and the refusal. A module of its own, so coverage:funcs does not load
 * the hook rules and what they import (#687).
 */

/**
 * The most test files coverage:funcs may run without a reason (#674). The guard hook lets the
 * coordinator's `--tests` list through; the script refuses every session without a reason (#725).
 */
export const HEAVY_TESTS = 20;

/** The forms a worker session runs instead of a full coverage run (#674). */
export const HEAVY_ALLOWED =
  "`bun run test:related -- --fast --tier unit,component`; each touched test with `bun --config=bunfig.area.toml test <file>`; or `bun run coverage:funcs <file> --tests <a few tests>`";

/** Whether an override's value is a reason, not a bare switch such as 1 or true (#674). */
export function heavyReasonGiven(value: string | undefined): boolean {
  // A reason is a few words: 1, true, no, x or - are placeholders (#687).
  return (value ?? "").trim().length >= 8;
}

/** The refusal of a full coverage run (#674), shared by the hook and coverage:funcs. */
export function heavyRunMessage(what: string): string {
  return `${what} holds the slot 12 to 25 minutes for the full coverage run that the PR's CI does anyway (#674). Run instead: ${HEAVY_ALLOWED}. For a real need, put FLIGHTDECK_SLOT_HEAVY="<reason>" in front of the command.`;
}
