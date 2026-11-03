import { describe, expect, test } from "bun:test";
import { hostNameError } from "../src/lib/host-name.ts";

const hosts = [
  { id: "a", name: "pc-nery" },
  { id: "b", name: "WSL" },
];

describe("host-nome", () => {
  test("an empty or blank name is refused", () => {
    expect(hostNameError("", hosts, "a")).toBe("empty");
    expect(hostNameError("   ", hosts, "a")).toBe("empty");
  });

  test("a name another host has is refused, ignoring case and spaces", () => {
    expect(hostNameError("wsl", hosts, "a")).toBe("duplicate");
    expect(hostNameError("  WSL ", hosts, "a")).toBe("duplicate");
  });

  test("the host's own name and a new one are fine", () => {
    expect(hostNameError("pc-nery", hosts, "a")).toBeNull();
    expect(hostNameError("Windows", hosts, "a")).toBeNull();
  });
});
