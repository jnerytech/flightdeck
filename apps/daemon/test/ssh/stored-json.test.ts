import { describe, expect, test } from "bun:test";
import { SshTargets } from "../../src/ssh/targets.ts";
import { EventStore } from "../../src/store/event-store.ts";

/** A target in a store of its own, and a way to damage one of its JSON columns. */
function setup() {
  const store = new EventStore(":memory:");
  const targets = new SshTargets({ db: store.db, now: () => Date.parse("2026-10-29T12:00:00Z") });
  const target = targets.save({ name: "vps", host: "vps.example.com", user: "deploy" });
  const damage = (column: "options" | "tags" | "host_key", text: string) =>
    store.db.query(`UPDATE ssh_targets SET ${column} = ? WHERE id = ?`).run(text, target.id);
  return { targets, target, damage };
}

/** The message of the error a call ends in. */
function messageOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return (error as Error).message;
  }
  return "it did not throw";
}

describe("ssh: the JSON columns of a destination are checked when read (#1609)", () => {
  test("a pinned key that does not fit is an error, never 'no key yet' that the next connect would pin again", () => {
    const { targets, target, damage } = setup();
    damage("host_key", JSON.stringify({ fingerprint: "SHA256:abc" }));
    expect(messageOf(() => targets.pinned(target.id))).toContain("does not fit");
    expect(messageOf(() => targets.get(target.id))).toContain("does not fit");
  });

  test("the error for a damaged column names no part of its text", () => {
    const { targets, target, damage } = setup();
    damage("host_key", "LEAKMARK-not-json");
    const message = messageOf(() => targets.pinned(target.id));
    expect(message).toBe("text is not JSON");
    damage("options", '{"forwardAgent": "LEAKMARK"}');
    expect(messageOf(() => targets.get(target.id))).not.toContain("LEAKMARK");
  });

  test("options and tags that do not fit are an error too, not a value of the wrong type", () => {
    const { targets, target, damage } = setup();
    damage("tags", '{"a": 1}');
    expect(messageOf(() => targets.get(target.id))).toContain("does not fit");
    damage("tags", "[]");
    damage("options", '{"forwardAgent": "yes"}');
    expect(messageOf(() => targets.get(target.id))).toContain("does not fit");
  });
});
