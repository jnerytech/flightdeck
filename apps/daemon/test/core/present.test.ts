import { describe, expect, test } from "bun:test";
import { present } from "../../src/present.ts";

describe("present", () => {
  test("leaves out a key whose value is undefined or null", () => {
    expect(present({ claude: undefined, account: null, hostName: "pi" })).toEqual({
      hostName: "pi",
    });
    expect(Object.keys(present({ a: undefined, b: null }))).toEqual([]);
  });

  test("keeps every other value, falsy ones too", () => {
    const service = { stop() {} };
    expect(present({ zero: 0, empty: "", off: false, service })).toEqual({
      zero: 0,
      empty: "",
      off: false,
      service,
    });
  });

  test("spreads into an option bag without adding a key that is not there", () => {
    const options = {
      port: 1,
      ...present({ updates: undefined, claude: { path: "/bin/claude" } }),
    };
    expect("updates" in options).toBe(false);
    expect(options).toEqual({ port: 1, claude: { path: "/bin/claude" } });
  });
});
