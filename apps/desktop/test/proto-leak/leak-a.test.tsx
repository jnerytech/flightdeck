import { describe, expect, test } from "bun:test";
import { registerDom } from "../dom.ts";

registerDom();

// What an earlier file of the same process left behind, whichever file runs first.
const seen = globalThis as unknown as { __protoMarkers?: Array<() => void> };
const markers = (seen.__protoMarkers ??= []);
const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
const leakedMethod = markers.some((m) => proto.scrollIntoView === m);
const leakedMember = "__fdLeak" in proto;

// This file patches the prototype and never puts it back, like the files that caused the leak.
const mine = () => {};
markers.push(mine);
proto.scrollIntoView = mine;
proto.__fdLeak = true;

describe("proto-leak: a patched DOM prototype does not outlive its file", () => {
  test("nothing an earlier file patched is still there", () => {
    expect(leakedMethod).toBe(false);
    expect(leakedMember).toBe(false);
  });
});
