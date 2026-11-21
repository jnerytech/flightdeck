import { describe, expect, test } from "bun:test";
import { notHigh } from "../support/permissions-risk-rules.ts";

describe("risk rules: external sessions and names from a session's shell (#3735)", () => {
  test("external list, message and watch and names list stay ordinary, as send and requests do", () => {
    expect(
      notHigh([
        "fd external list",
        "fd external list --json",
        "fd external message ext-1 --text 'go on'",
        "flightdeckd --host pi external message ext-1 --text hello",
        "fd external watch --json",
        "fd names list",
        "fd names list --json --host pi",
        "flightdeckd fd external message ext-1 --text hi",
      ]),
    ).toEqual([]);
  });
});
