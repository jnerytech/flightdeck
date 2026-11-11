import { describe, expect, test } from "bun:test";
import { channelText } from "../../src/central/channel.ts";
import { ExternalSessions } from "../../src/central/external.ts";
import { EventStore } from "../../src/store/event-store.ts";

describe("channelText: a frame from the receptor", () => {
  test("a message frame gives its text", () => {
    expect(channelText('{"text":"hello"}')).toBe("hello");
  });
  test("a frame that is not JSON, has no text or a non-text one is skipped", () => {
    expect(channelText("{nope")).toBeNull();
    expect(channelText("{}")).toBeNull();
    expect(channelText('{"text":3}')).toBeNull();
    expect(channelText("[1]")).toBeNull();
  });
});

describe("a persona stored for an external session", () => {
  test("one that is no persona reads as none", () => {
    const store = new EventStore(":memory:");
    const external = new ExternalSessions({ db: store.db, staleAfterS: 900 });
    external.apply("SessionStart", { session_id: "s1", cwd: "/p" });
    store.db.query("UPDATE external_sessions SET persona_applied = ?").run('{"id":5}');
    expect(external.get("s1")?.persona).toBeUndefined();
    store.db.query("UPDATE external_sessions SET persona_applied = ?").run("{nope");
    expect(external.get("s1")?.persona).toBeUndefined();
    expect(external.appliedPersona("s1")).toBeNull();
  });
});
