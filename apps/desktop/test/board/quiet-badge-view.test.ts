import { describe, expect, test } from "bun:test";
import { quietBadge } from "../../src/features/board/quiet-badge-view.ts";
import type { QuietAlert } from "../../src/features/needs-you/domain/quiet.ts";
import { translator } from "../../src/i18n/index.ts";

const t = translator("en");
const NOW = Date.parse("2026-11-11T12:00:00Z");

const alert = (over: Partial<QuietAlert> = {}): QuietAlert => ({
  key: "h1/s1",
  hostId: "h1",
  hostName: "alpha",
  sessionId: "s1",
  title: "api",
  since: "2026-11-11T11:37:00Z",
  tool: null,
  ...over,
});

const alerts = (...list: QuietAlert[]) => new Map(list.map((a) => [a.key, a]));

describe("quiet-badge-view: the words of a card's quiet badge", () => {
  test("a card with no session has no badge", () => {
    expect(quietBadge({ sessionId: null }, "h1", alerts(alert()), NOW, t)).toBeNull();
  });

  test("a card whose session is not quiet has no badge", () => {
    expect(quietBadge({ sessionId: "s2" }, "h1", alerts(alert()), NOW, t)).toBeNull();
  });

  test("the session is looked up on the card's own host", () => {
    expect(quietBadge({ sessionId: "s1" }, "h2", alerts(alert()), NOW, t)).toBeNull();
  });

  test("a quiet session says for how long, short on the card and in full on hover", () => {
    expect(quietBadge({ sessionId: "s1" }, "h1", alerts(alert()), NOW, t)).toEqual({
      short: "Quiet 23 min",
      full: "Quiet for 23 min",
    });
  });

  test("the full words name the last tool the session ran", () => {
    expect(quietBadge({ sessionId: "s1" }, "h1", alerts(alert({ tool: "Bash" })), NOW, t)).toEqual({
      short: "Quiet 23 min",
      full: "Quiet for 23 min · last: Bash",
    });
  });

  test("a session that went quiet in the future reads as no time at all", () => {
    const future = alert({ since: "2026-11-11T12:05:00Z" });
    expect(quietBadge({ sessionId: "s1" }, "h1", alerts(future), NOW, t)).toEqual({
      short: "Quiet 0 s",
      full: "Quiet for 0 s",
    });
  });
});
