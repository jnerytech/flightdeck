import { describe, expect, test } from "bun:test";
import type { ExternalPermissionFrame } from "@flightdeck/protocol";
import {
  approvalRequestOf,
  externalRequestsOf,
  externalTitle,
} from "../../src/features/sessions/external-view.ts";

const frame = (over: Partial<ExternalPermissionFrame> = {}): ExternalPermissionFrame => ({
  type: "external.permission",
  requestId: "ext-1",
  claudeSessionId: "s1",
  toolName: "Bash",
  input: { command: "ls" },
  state: "open",
  createdAt: "2026-11-11T10:00:00Z",
  ...over,
});

describe("externalTitle", () => {
  test("the person's name wins over the folder", () => {
    expect(externalTitle("Fix login", "/home/ana/app", "Session")).toBe("Fix login");
  });

  test("with no name the folder's own name, and with neither the untitled text", () => {
    expect(externalTitle(undefined, "/home/ana/app", "Session")).toBe("app");
    expect(externalTitle(undefined, null, "Session")).toBe("Session");
    expect(externalTitle(undefined, undefined, "Session")).toBe("Session");
  });
});

describe("externalRequestsOf", () => {
  test("only this host's requests that belong to this session", () => {
    const queue = {
      "h1/ext-1": frame({ requestId: "ext-1" }),
      "h1/ext-2": frame({ requestId: "ext-2", claudeSessionId: "s2" }),
      "h2/ext-3": frame({ requestId: "ext-3" }),
    };
    expect(externalRequestsOf(queue, "h1", "s1").map((r) => r.requestId)).toEqual(["ext-1"]);
  });

  test("a host id that only starts the same way is another host", () => {
    const queue = { "h10/ext-1": frame() };
    expect(externalRequestsOf(queue, "h1", "s1")).toEqual([]);
  });
});

describe("approvalRequestOf", () => {
  test("carries the request and the session's folder", () => {
    expect(approvalRequestOf(frame(), "/home/ana/app")).toEqual({
      requestId: "ext-1",
      toolName: "Bash",
      input: { command: "ls" },
      cwd: "/home/ana/app",
      createdAt: "2026-11-11T10:00:00Z",
    });
  });

  test("suggestions, risk and its reason go along only when the host sent them", () => {
    const full = approvalRequestOf(
      frame({ risk: "high", riskReason: "rm -rf", suggestions: [] }),
      null,
    );
    expect(full.cwd).toBeNull();
    expect(full.risk).toBe("high");
    expect(full.riskReason).toBe("rm -rf");
    expect(full.suggestions).toEqual([]);
    expect("risk" in approvalRequestOf(frame(), null)).toBe(false);
    expect("suggestions" in approvalRequestOf(frame(), null)).toBe(false);
  });
});
