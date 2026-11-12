import { describe, expect, test } from "bun:test";
import { parseReviewLog } from "../../lib/pr/review-record.ts";

describe("review record (#1707)", () => {
  test("reads the sha each value of a review trailer names, from the commits of the branch log", () => {
    const log = [
      "\x1eabc1234 no findings\x1d9999999 earlier run",
      "\x1e",
      "\x1edef5678 two lows",
    ].join("\n");
    expect(parseReviewLog(log)).toEqual(["abc1234", "9999999", "def5678"]);
  });

  test("a trailer with no sha, or one that is not lowercase hex of 7 to 40 characters, names nothing", () => {
    const log = "\x1eran fine\n\x1e--output=x ran\n\x1eABC1234 upper\n\x1eabc12 short";
    expect(parseReviewLog(log)).toEqual([]);
  });
});
