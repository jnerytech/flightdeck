import { describe, expect, test } from "bun:test";
import { WHATS_NEW_KEY, WhatsNew } from "../src/lib/whats-new.ts";

const memory = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    data,
  };
};

describe("whats-new-lib: a dot after an update, gone once the notes were opened (issue #125)", () => {
  test("a first run has no dot and remembers the version it started on", () => {
    const storage = memory();
    const notes = new WhatsNew(storage, "0.38.0");
    expect(notes.hasNew()).toBe(false);
    expect(storage.data.get(WHATS_NEW_KEY)).toBe("0.38.0");
  });

  test("after an update the dot shows, opening the notes clears it, and a later start keeps it cleared", () => {
    const storage = memory({ [WHATS_NEW_KEY]: "0.37.4" });
    const notes = new WhatsNew(storage, "0.38.0");
    expect(notes.hasNew()).toBe(true);
    notes.markSeen();
    expect(notes.hasNew()).toBe(false);
    expect(storage.data.get(WHATS_NEW_KEY)).toBe("0.38.0");
    expect(new WhatsNew(storage, "0.38.0").hasNew()).toBe(false);
  });

  test("the same version, an older one (a downgrade) or a value that is no version never show a dot", () => {
    expect(new WhatsNew(memory({ [WHATS_NEW_KEY]: "0.38.0" }), "0.38.0").hasNew()).toBe(false);
    expect(new WhatsNew(memory({ [WHATS_NEW_KEY]: "0.39.0" }), "0.38.0").hasNew()).toBe(false);
    expect(new WhatsNew(memory({ [WHATS_NEW_KEY]: "garbage" }), "0.38.0").hasNew()).toBe(false);
  });

  test("a release candidate counts as the version it leads up to", () => {
    expect(new WhatsNew(memory({ [WHATS_NEW_KEY]: "0.37.4" }), "0.38.0-rc.1").hasNew()).toBe(true);
    expect(new WhatsNew(memory({ [WHATS_NEW_KEY]: "0.38.0" }), "0.38.0-rc.2").hasNew()).toBe(false);
  });

  test("listeners hear that the dot went, and stop hearing once they unsubscribe", () => {
    const notes = new WhatsNew(memory({ [WHATS_NEW_KEY]: "0.37.4" }), "0.38.0");
    let heard = 0;
    const off = notes.subscribe(() => {
      heard += 1;
    });
    notes.markSeen();
    expect(heard).toBe(1);
    off();
    notes.markSeen();
    expect(heard).toBe(1);
  });

  test("a storage that refuses to write does not stop the app", () => {
    const refusing = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
    };
    const notes = new WhatsNew(refusing, "0.38.0");
    expect(notes.hasNew()).toBe(false);
    expect(() => notes.markSeen()).not.toThrow();
  });

  test("a storage that refuses to read shows no dot and does not stop the app", () => {
    const unreadable = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {},
    };
    const notes = new WhatsNew(unreadable, "0.38.0");
    expect(notes.hasNew()).toBe(false);
    expect(() => notes.markSeen()).not.toThrow();
  });
});
