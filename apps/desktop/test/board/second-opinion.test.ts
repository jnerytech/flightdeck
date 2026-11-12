import { describe, expect, test } from "bun:test";
import { findingsNote, openFindings } from "../../src/features/board/second-opinion.ts";
import { translator } from "../../src/i18n/index.ts";

/**
 * #1446: the Open PR confirm says how many reviewer findings are still open when a blocker or a
 * high one is. Only reviewer drafts count: a sent one, an edited one (the person's now) and the
 * person's own comments do not.
 */
const t = translator("en");
const tPt = translator("pt-BR");
const comment = (over: object = {}) =>
  ({ id: "r", state: "draft", author: "reviewer", severity: "low", ...over }) as never;

describe("second-opinion: the reviewer findings still open (#1446)", () => {
  test("counts open reviewer drafts, and how many are blocker or high", () => {
    expect(
      openFindings([
        comment({ severity: "blocker" }),
        comment({ severity: "high" }),
        comment({ severity: "medium" }),
        comment({ severity: "low" }),
      ]),
    ).toEqual({ open: 4, high: 2 });
  });

  test("a sent finding, an edited one and the person's own comments do not count", () => {
    expect(
      openFindings([
        comment({ state: "sent", severity: "high" }),
        comment({ author: undefined, severity: "high" }),
        comment({ author: undefined, severity: undefined }),
        comment({ severity: "high" }),
      ]),
    ).toEqual({ open: 1, high: 1 });
  });

  test("the line names the open findings and how many are high, only when one is", () => {
    const one = [comment({ severity: "high" })];
    const many = [comment({ severity: "blocker" }), comment({ severity: "low" })];
    const lows = [comment({ severity: "low" }), comment({ severity: "medium" })];
    expect([findingsNote(t, one), findingsNote(t, many), findingsNote(t, lows)]).toEqual([
      "1 reviewer finding not addressed (1 high)",
      "2 reviewer findings not addressed (1 high)",
      null,
    ]);
    expect(findingsNote(t, [])).toBeNull();
  });

  test("in pt-BR the line is translated", () => {
    expect(findingsNote(tPt, [comment({ severity: "high" }), comment({ severity: "low" })])).toBe(
      "2 achados do revisor sem tratar (alto: 1)",
    );
  });
});
