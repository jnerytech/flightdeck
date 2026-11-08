import { describe, expect, test } from "bun:test";
import { loadFinished, sinceLastLook } from "../../apps/desktop/src/lib/finished.ts";
import { parseRequestLink } from "../../apps/desktop/src/lib/request-link.ts";
import { demoFinished, demoInbox } from "../lib/demo-seeds.ts";

type Entry = { id: string; ask?: string; link?: string; group?: string };
const inbox = (lang: string, request?: { hostId: string; requestId: string }) =>
  JSON.parse(demoInbox(lang, request)) as Entry[];

describe("demoInbox (#1168)", () => {
  test("the web request row links to the live request it is given, in both languages", () => {
    for (const lang of ["en", "pt-BR"]) {
      const rows = inbox(lang, { hostId: "demo-alfa", requestId: "req-9" });
      const linked = rows.filter((row) => row.link !== undefined);
      expect(linked.map((row) => row.group)).toEqual(["alfa/web"]);
      expect(parseRequestLink(linked[0]?.link ?? "")).toEqual({
        hostId: "demo-alfa",
        requestId: "req-9",
      });
    }
  });

  test("with no live request no row carries a link", () => {
    expect(inbox("en").some((row) => row.link !== undefined)).toBe(false);
  });
});

describe("demoFinished (#1168)", () => {
  test("seeds one finish that Needs you lists, since no look yet", () => {
    const now = new Date("2026-11-08T12:00:00Z");
    const raw = demoFinished({ hostId: "demo-alfa", sessionId: "s1", name: "Review" }, now);
    const state = loadFinished({ getItem: () => raw });
    expect(sinceLastLook(state.list, state.lastLook).map((f) => f.key)).toEqual(["demo-alfa/s1"]);
  });
});
