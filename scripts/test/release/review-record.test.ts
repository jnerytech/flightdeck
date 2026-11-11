import { describe, expect, test } from "bun:test";
import { parseReviewLog } from "../../lib/review-record.ts";

describe("review record (#1707)", () => {
  test("reads the sha each review trailer names, from the commits of the branch log", () => {
    const log = [
      "\x1eabc1234 no findings\x1fdef5678 two lows, fixed",
      "\x1e\x1f",
      "\x1e9999999 earlier run\x1f",
    ].join("\n");
    expect(parseReviewLog(log)).toEqual({ code: ["abc1234", "9999999"], security: ["def5678"] });
  });

  test("a trailer with no sha, or one that is not hex, names nothing", () => {
    const log = "\x1eran fine\x1f--output=x ran\n\x1eABC1234 upper\x1fabc12 short";
    expect(parseReviewLog(log)).toEqual({ code: [], security: [] });
  });
});
