import { describe, expect, test } from "bun:test";
import type { ApprovalProof, PermissionUpdate } from "@flightdeck/protocol";
import type { ProofResult } from "../../src/features/approval/index.ts";
import { PermissionsSlice } from "../../src/features/permissions/index.ts";
import { translator } from "../../src/i18n/index.ts";
import type { PendingItem } from "../../src/lib/app-store.ts";

const t = translator("en");
const PROOF: ApprovalProof = { keyId: "k", nonce: "n", signature: "s" };

/** A slice over stand-ins, with the proof path answering `outcome` (or throwing `fails`). */
function permissions(
  over: { outcome?: ProofResult; fails?: Error; risk?: "high" | "low"; selected?: string } = {},
) {
  const log: unknown[] = [];
  const slice = new PermissionsSlice({
    needsYou: () =>
      [{ hostId: "h1", requestId: "r1", risk: over.risk ?? "high" }] as unknown as PendingItem[],
    sessions: () => ({}),
    selectedHostId: () => over.selected,
    settleVault: () => false,
    sendOn: async (hostId, response) => void log.push({ on: hostId, response }),
    sendSelected: async (response) => void log.push({ selected: response }),
    fail: (error, text) =>
      void log.push({ fail: error instanceof Error ? error.message : String(error), text }),
    t: () => t,
    showWindow: () => {},
    act: () => {},
    prove: async (hostId, answer, risk) => {
      log.push({ prove: [hostId, answer, risk] });
      if (over.fails) throw over.fails;
      return over.outcome ?? { kind: "proof", proof: PROOF };
    },
  });
  return { slice, log };
}

const rule: PermissionUpdate = {
  type: "addRules",
  rules: [{ toolName: "Bash", ruleContent: "ls" }],
  behavior: "allow",
  destination: "localSettings",
};

describe("permissions: an allow carries the proof of this device (#3439)", () => {
  test("a held high-risk allow from the queue is proved with its risk, then sent with the proof and the hold", async () => {
    const { slice, log } = permissions();
    await slice.respondTo("h1", "r1", "allow", { held: true, message: "go" });
    expect(log).toEqual([
      {
        prove: [
          "h1",
          {
            requestId: "r1",
            decision: "allow",
            message: "go",
            updatedPermissions: undefined,
            updatedInput: undefined,
          },
          "high",
        ],
      },
      {
        on: "h1",
        response: { requestId: "r1", decision: "allow", message: "go", held: true, proof: PROOF },
      },
    ]);
  });

  test("the answer of the open session is proved on the selected host and sent with the proof", async () => {
    const { slice, log } = permissions({ selected: "h1" });
    await slice.respond("r1", "allow", { held: true, updatedPermissions: [rule] });
    expect(log.at(-1)).toEqual({
      selected: {
        requestId: "r1",
        decision: "allow",
        updatedPermissions: [rule],
        held: true,
        proof: PROOF,
      },
    });
  });

  test("when the device needs no proof the answer goes as it was, with no proof key", async () => {
    const { slice, log } = permissions({ outcome: { kind: "none" } });
    await slice.respondTo("h1", "r1", "allow", { held: true });
    expect(log.at(-1)).toEqual({
      on: "h1",
      response: { requestId: "r1", decision: "allow", held: true },
    });
  });

  test("when the person declines the system's dialog, nothing is sent and nothing is shown", async () => {
    const { slice, log } = permissions({ outcome: { kind: "declined" }, selected: "h1" });
    await slice.respondTo("h1", "r1", "allow", { held: true });
    await slice.respond("r1", "allow", { held: true });
    expect(log.filter((entry) => !("prove" in (entry as object)))).toEqual([]);
  });

  test("a proof that cannot be made reaches the banner with its text, and nothing is sent", async () => {
    const { slice, log } = permissions({ fails: new Error("no key here") });
    await slice.respondTo("h1", "r1", "allow", { held: true });
    expect(log.filter((entry) => !("prove" in (entry as object)))).toEqual([
      { fail: "no key here", text: undefined },
    ]);
  });

  test("a deny is sent as it was and asks for no proof", async () => {
    const { slice, log } = permissions();
    await slice.respondTo("h1", "r1", "deny", { message: "no" });
    expect(log).toEqual([
      { on: "h1", response: { requestId: "r1", decision: "deny", message: "no" } },
    ]);
  });

  test("an allow that is not held is still refused before any proof is asked", async () => {
    const { slice, log } = permissions();
    await slice.respondTo("h1", "r1", "allow", {});
    expect(log.some((entry) => "prove" in (entry as object))).toBe(false);
    expect(log).toEqual([{ fail: t("approval.holdRequired"), text: t("approval.holdRequired") }]);
  });
});
