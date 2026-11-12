import { describe, expect, test } from "bun:test";
import { hostInitial, hostRailLabel } from "../../src/features/hosts/host-rail.ts";

describe("hostRailLabel", () => {
  test("joins the name and the version with a middle dot", () => {
    expect(hostRailLabel("pi", "v0.37.2")).toBe("pi · v0.37.2");
  });

  test("is only the name when the host announces no version", () => {
    expect(hostRailLabel("pi", null)).toBe("pi");
  });
});

describe("hostInitial", () => {
  test("is the first letter of the name, upper-cased", () => {
    expect(hostInitial("orange")).toBe("O");
  });

  test("takes a whole character, not half of a surrogate pair", () => {
    expect(hostInitial("😀box")).toBe("😀");
  });

  test("is a question mark for an empty name", () => {
    expect(hostInitial("")).toBe("?");
  });
});
