import { describe, expect, test } from "bun:test";
import {
  type SummarySnapshot,
  summaryNotifications,
} from "../../src/features/inbox/domain/notify.ts";
import { translator } from "../../src/i18n/index.ts";

const running: SummarySnapshot = { status: "running", pendingPermissions: [] };
const quiet: SummarySnapshot = { ...running, quietSince: "2026-11-09T12:05:00.000Z" };
const en = translator("en");

describe("stall-notify: one notification when a session goes quiet (issue #1478)", () => {
  test("a session that turns quiet is told once, and the text says what to do", () => {
    expect(summaryNotifications(running, quiet, "alfa · api", false, { t: en })).toEqual([
      {
        event: "needs-you",
        title: "alfa · api: gone quiet",
        body: "Nothing has happened for a while. Open it to see where it stopped.",
      },
    ]);
  });

  test("the next summaries of the same stall say nothing", () => {
    expect(summaryNotifications(running, quiet, "alfa · api", false, { t: en })).toHaveLength(1);
    expect(summaryNotifications(quiet, quiet, "alfa · api", false, { t: en })).toEqual([]);
    expect(
      summaryNotifications(quiet, { ...quiet, quietSince: "2026-11-09T12:05:00.000Z" }, "x", false),
    ).toEqual([]);
  });

  test("a quiet summary stamped again (the host re-marks the same stall) is not a new stall", () => {
    const later = { ...quiet, quietSince: "2026-11-09T12:07:00.000Z" };
    expect(summaryNotifications(quiet, later, "alfa · api", false, { t: en })).toEqual([]);
  });

  test("it moves again and goes quiet later: a new stall is a new notification", () => {
    expect(summaryNotifications(quiet, running, "x", false, { t: en })).toEqual([]);
    expect(summaryNotifications(running, quiet, "x", false, { t: en })).toHaveLength(1);
  });

  test("nothing for the first summary seen (a stall that began before we connected) or in focus", () => {
    expect(summaryNotifications(running, quiet, "x", false, { t: en })).toHaveLength(1);
    expect(summaryNotifications(undefined, quiet, "x", false, { t: en })).toEqual([]);
    expect(summaryNotifications(running, quiet, "x", true, { t: en })).toEqual([]);
  });

  test("in Portuguese", () => {
    const [n] = summaryNotifications(running, quiet, "alfa · api", false, {
      t: translator("pt-BR"),
    });
    expect(n?.title).toBe("alfa · api: em silêncio");
    expect(n?.body).toBe("Nada aconteceu há um tempo. Abra para ver onde parou.");
  });
});
