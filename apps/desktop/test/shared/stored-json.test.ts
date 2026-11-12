import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { readStored } from "../../src/shared/lib/stored-json.ts";

const Prefs = z.object({
  mode: z.enum(["a", "b"]).catch("a"),
  count: z.number().int().nonnegative().catch(0),
});
const NOTHING = { mode: "a" as const, count: 0 };

const kept = (value: string | null) => ({ getItem: () => value });

describe("readStored (#1609)", () => {
  test("a stored value that fits the schema comes back parsed", () => {
    expect(readStored(kept('{"mode":"b","count":3}'), "k", Prefs, NOTHING)).toEqual({
      mode: "b",
      count: 3,
    });
  });

  test("the key it reads is the key it was given", () => {
    const keys: string[] = [];
    const spy = {
      getItem: (key: string) => {
        keys.push(key);
        return null;
      },
    };
    readStored(spy, "flightdeck.thing", Prefs, NOTHING);
    expect(keys).toEqual(["flightdeck.thing"]);
  });

  test("nothing stored, or text that is not JSON, gives the fallback", () => {
    expect(readStored(kept(null), "k", Prefs, NOTHING)).toBe(NOTHING);
    expect(readStored(kept("{not json"), "k", Prefs, NOTHING)).toBe(NOTHING);
    expect(readStored(kept(""), "k", Prefs, NOTHING)).toBe(NOTHING);
  });

  test("a value of the wrong shape is not trusted: the fallback, or the schema's own field defaults", () => {
    const strict = z.array(z.string());
    expect(readStored(kept('{"a":1}'), "k", strict, [])).toEqual([]);
    expect(readStored(kept("[1,2]"), "k", strict, ["x"])).toEqual(["x"]);
    expect(readStored(kept("null"), "k", strict, ["x"])).toEqual(["x"]);
    // a lenient field falls back on its own, and the rest of the value is kept
    expect(readStored(kept('{"mode":"zzz","count":-2}'), "k", Prefs, NOTHING)).toEqual(NOTHING);
    expect(readStored(kept('{"mode":"b","count":"many"}'), "k", Prefs, NOTHING)).toEqual({
      mode: "b",
      count: 0,
    });
  });

  test("a storage that refuses to answer gives the fallback", () => {
    const refusing = {
      getItem: () => {
        throw new Error("storage is blocked");
      },
    };
    expect(readStored(refusing, "k", Prefs, NOTHING)).toBe(NOTHING);
  });
});
