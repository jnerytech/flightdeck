import { describe, expect, test } from "bun:test";
import { hostDuplicates } from "../../src/features/hosts/domain/host-duplicate.ts";

/** Issue #3884: Add host refuses a name, or an address and port, that another host already has. */
const hosts = [
  { name: "My PC", url: "ws://100.64.0.1:7420/v1/ws" },
  { name: "lab", url: "ws://[fd7a::1]:7420/v1/ws" },
];
const draft = (patch: Partial<{ name: string; address: string; port: string }>) => ({
  name: "new",
  address: "100.64.0.9",
  port: "7420",
  token: "t",
  ...patch,
});

describe("host-duplicado", () => {
  test("a name another host has is refused, trimmed and in any case, naming that host", () => {
    expect(hostDuplicates(draft({ name: "  my pc " }), hosts)).toEqual({ name: "My PC" });
  });

  test("an address and port another host uses is refused, naming that host", () => {
    expect(hostDuplicates(draft({ address: "100.64.0.1" }), hosts)).toEqual({ address: "My PC" });
  });

  test("another port on the same address is accepted", () => {
    expect(hostDuplicates(draft({ address: "100.64.0.1", port: "7421" }), hosts)).toEqual({});
  });

  test("an address written another way that gives the same url counts as the same", () => {
    expect(hostDuplicates(draft({ address: "FD7A:0:0:0:0:0:0:1" }), hosts)).toEqual({
      address: "lab",
    });
  });

  test("an address pasted with spaces around it still counts as the same", () => {
    expect(hostDuplicates(draft({ address: " 100.64.0.1 " }), hosts)).toEqual({ address: "My PC" });
  });

  test("a name and address nobody has give no duplicate", () => {
    expect(hostDuplicates(draft({}), hosts)).toEqual({});
  });

  test("both fields can be taken, by different hosts", () => {
    expect(hostDuplicates(draft({ name: "lab", address: "100.64.0.1" }), hosts)).toEqual({
      name: "lab",
      address: "My PC",
    });
  });

  test("an address that makes no url is no duplicate of anything", () => {
    expect(hostDuplicates(draft({ address: "bad host", port: "7420" }), hosts)).toEqual({});
  });
});
