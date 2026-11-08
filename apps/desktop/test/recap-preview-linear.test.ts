import { describe, expect, test } from "bun:test";
import type { SessionRecap } from "@flightdeck/protocol";
import { recapPreview } from "../src/lib/recap-preview.ts";

/**
 * Issue #363 (Sonar S8786): the folded line of a recap strips its list marks with a pattern that
 * crosses line breaks. The daemon cuts a recap field at 480 characters, but the protocol does not,
 * and the app shows what a paired host sends, so the text is cut before it is read.
 */
const FAST_MS = 1500;
const took = (run: () => unknown): number => {
  const started = performance.now();
  run();
  return performance.now() - started;
};
const recap = (done: string | null, asked: string | null = null): SessionRecap =>
  ({ done, asked }) as SessionRecap;

describe("recap-preview-linear: the folded line", () => {
  test.each([
    ["- fixed the bug", "fixed the bug"],
    ["• one\n• two", "one two"],
    ["**bold** and `code`", "bold and code"],
    ["a\n-\nb", "a b"],
    ["  \n\n- x", "x"],
    ["a - b", "a - b"],
  ])("%j shows %j", (done, expected) => {
    expect(recapPreview(recap(done))).toBe(expected);
  });

  test("the asked text shows when nothing was done", () => {
    expect(recapPreview(recap(null, "what is x?"))).toBe("what is x?");
  });

  test("a long text is cut with an ellipsis at 160 characters", () => {
    const shown = recapPreview(recap("word ".repeat(500)));
    expect(shown.length).toBeLessThanOrEqual(160);
    expect(shown.endsWith("…")).toBe(true);
  });

  test("a text of blank lines a host sent is read in a moment", () => {
    expect(took(() => recapPreview(recap("\n".repeat(45_000))))).toBeLessThan(FAST_MS);
    expect(took(() => recapPreview(recap(`${"\n ".repeat(25_000)}x`)))).toBeLessThan(FAST_MS);
  });
});
