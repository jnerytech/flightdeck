import { describe, expect, test } from "bun:test";
import type { DepsResult } from "@flightdeck/protocol";
import { hostNeedsAttention } from "../../src/features/hosts/host-attention.ts";
import type { HostView } from "../../src/lib/app-state.ts";

type Subject = Pick<HostView, "status" | "hostInfo">;

const host = (status: HostView["status"], apiKeySanitized?: boolean): Subject => ({
  status,
  hostInfo: apiKeySanitized === undefined ? null : ({ apiKeySanitized } as HostView["hostInfo"]),
});

const deps = (group: "required" | "optional", state: "ok" | "missing" | "outdated"): DepsResult =>
  ({ items: [{ id: "git", group, state, breaks: [], fix: [] }] }) as unknown as DepsResult;

describe("hostNeedsAttention", () => {
  test("a connected host with nothing wrong needs none", () => {
    expect(hostNeedsAttention(host("online", true), deps("required", "ok"))).toBe(false);
  });

  test("a host the app cannot reach needs a look, whichever way it fails", () => {
    expect(hostNeedsAttention(host("offline"), undefined)).toBe(true);
    expect(hostNeedsAttention(host("unauthorized"), undefined)).toBe(true);
    expect(hostNeedsAttention(host("incompatible"), undefined)).toBe(true);
  });

  test("a host still connecting is not flagged yet", () => {
    expect(hostNeedsAttention(host("connecting"), undefined)).toBe(false);
  });

  test("a required dependency missing flags the host; an optional or outdated one does not", () => {
    expect(hostNeedsAttention(host("online"), deps("required", "missing"))).toBe(true);
    expect(hostNeedsAttention(host("online"), deps("optional", "missing"))).toBe(false);
    expect(hostNeedsAttention(host("online"), deps("required", "outdated"))).toBe(false);
  });

  test("a forwarded API key flags the host; an unknown answer does not", () => {
    expect(hostNeedsAttention(host("online", false), undefined)).toBe(true);
    expect(hostNeedsAttention(host("online", true), undefined)).toBe(false);
    expect(hostNeedsAttention(host("online"), undefined)).toBe(false);
  });
});
