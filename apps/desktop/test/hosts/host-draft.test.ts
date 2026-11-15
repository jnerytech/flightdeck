import { describe, expect, test } from "bun:test";
import { draftFromLink, draftUrl, emptyDraft } from "../../src/features/hosts/domain/host-draft.ts";

describe("host draft", () => {
  test("an empty draft names the daemon's default port", () => {
    expect(emptyDraft()).toEqual({ name: "", address: "", port: "7420", token: "" });
  });

  test("the URL of a draft puts an IPv6 address in brackets", () => {
    expect(draftUrl({ name: "pi", address: "10.0.0.5", port: "7420", token: "x" })).toBe(
      "ws://10.0.0.5:7420/v1/ws",
    );
    expect(draftUrl({ name: "pi", address: "fd00::5", port: "7421", token: "x" })).toBe(
      "ws://[fd00::5]:7421/v1/ws",
    );
  });

  test("a draft read from a link takes the host and port and keeps the name and token it was given", () => {
    expect(draftFromLink("ws://10.0.0.5:7420/v1/ws", "pi", "fake-token")).toEqual({
      name: "pi",
      address: "10.0.0.5",
      port: "7420",
      token: "fake-token",
    });
    expect(draftFromLink("ws://[fd00::5]:7421/v1/ws", "pi", "fake-token").address).toBe("fd00::5");
  });
});
