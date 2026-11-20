import { afterEach, describe, expect, test } from "bun:test";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import {
  type ApprovalProof,
  approvalDigests,
  approvalMessage,
  enrollFirstMessage,
  type PermissionUpdate,
} from "@flightdeck/protocol";
import { ExternalPermissions } from "../../src/central/external-permissions.ts";
import { FlightdeckError } from "../../src/kernel/errors.ts";
import { Approvers } from "../../src/permissions/approvers.ts";
import { sha256Hex } from "../../src/permissions/domain/approval-gate.ts";
import { RiskClassifier } from "../../src/permissions/domain/risk.ts";
import type { PermissionDecision } from "../../src/permissions/index.ts";
import { PermissionBroker } from "../../src/permissions/permission-broker.ts";
import { EventStore } from "../../src/store/event-store.ts";
import { poll } from "../support/helpers.ts";

const CWD = "/work/proj";
const cleanups: Array<() => unknown> = [];
afterEach(() => {
  for (const fn of cleanups.splice(0).reverse()) fn();
});

const risks = new RiskClassifier({ allowedRoots: [CWD], home: "/home/u" });
const HIGH = { command: "rm -rf build" };
const ASKER = { connection: 1, address: "100.64.0.7", client: "flightdeck-app" };

const reasonOf = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    if (error instanceof FlightdeckError) return error.reason;
    throw error;
  }
  return null;
};

/** A host with approvers and one enrolled device (or none), and the way that device signs an allow. */
function host(enrolled: boolean) {
  const store = new EventStore(":memory:");
  cleanups.push(() => store.close());
  let n = 0;
  const approvers = new Approvers(store.db, {
    now: () => new Date("2026-11-20T12:00:00.000Z"),
    mono: () => 1_000,
    random: () => `rnd-${++n}-${"x".repeat(32)}`,
  });
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const spki = publicKey.export({ type: "spki", format: "der" });
  const pub = spki.toString("base64");
  const keyId = createHash("sha256").update(spki).digest("hex");
  const signText = (text: string) =>
    sign("sha256", Buffer.from(text), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString(
      "base64",
    );
  if (enrolled) {
    approvers.store.openWindow(sha256Hex("code"), new Date("2026-11-20T12:05:00.000Z"));
    const { nonce, daemonId } = approvers.challenge("enroll", undefined, 1);
    approvers.enroll(
      {
        publicKey: pub,
        name: "phone",
        nonce,
        signature: signText(
          enrollFirstMessage({ daemonId, nonce, publicKey: pub, codeHash: sha256Hex("code") }),
        ),
        code: "code",
      },
      ASKER,
    );
  }
  /** The proof the device makes for an allow of `requestId` carrying `answer`; `nonceFor` is the request the nonce was asked for. */
  const proofFor = (
    requestId: string,
    answer: { updatedPermissions?: unknown[]; message?: string } = {},
    nonceFor = requestId,
  ): ApprovalProof => {
    const { nonce, daemonId } = approvers.challenge("approve", nonceFor, 1);
    const digests = approvalDigests(answer);
    const message = approvalMessage({
      keyId,
      daemonId,
      requestId,
      nonce,
      permissionsHash: sha256Hex(digests.permissions),
      inputHash: sha256Hex(digests.input),
      messageHash: sha256Hex(digests.message),
    });
    return { keyId, nonce, signature: signText(message) };
  };
  return { approvers, proofFor };
}

function broker(approvers: Approvers) {
  const store = new EventStore(":memory:");
  cleanups.push(() => store.close());
  store.createSession({
    id: "s",
    name: null,
    cwd: CWD,
    status: "running",
    permissionMode: "default",
    model: null,
  });
  const requested: string[] = [];
  const b = new PermissionBroker(store, {
    emit: (_id, event) => {
      if (event.type === "permission.requested") requested.push(event.requestId);
    },
    onPendingChange: () => {},
    classify: (_id, tool, input) => risks.classify(tool, input, CWD),
    approval: approvers.gate,
  });
  const ask = async (input: Record<string, unknown>) => {
    const result: { value?: PermissionDecision } = {};
    const pending = b.request("s", "Bash", input, new AbortController().signal).then((d) => {
      result.value = d;
    });
    await poll(() => requested.length > 0);
    return { id: requested[requested.length - 1] ?? "", result, pending };
  };
  return { b, ask };
}

function external(approvers: Approvers) {
  const permissions = new ExternalPermissions({ risk: risks, approval: approvers.gate });
  permissions.watch(() => {});
  const ask = (command: string) => {
    const frames: string[] = [];
    permissions.watch((frame) => frames.push(frame.requestId));
    const answer = permissions.hold(
      {
        session_id: "s1",
        hook_event_name: "PermissionRequest",
        cwd: CWD,
        tool_name: "Bash",
        tool_input: { command },
      },
      new AbortController().signal,
    );
    return { id: frames[0] ?? "", answer };
  };
  return { permissions, ask };
}

const rule: PermissionUpdate = {
  type: "addRules",
  rules: [{ toolName: "Bash", ruleContent: "ls:*" }],
  behavior: "allow",
  destination: "localSettings",
};

describe("approval-wiring: a managed session's high-risk allow needs the device's proof once one is enrolled (#3439)", () => {
  test("Given a key, When a high-risk allow carries only the hold, Then it is refused and the request stays open", async () => {
    const { approvers, proofFor } = host(true);
    const { b, ask } = broker(approvers);
    const { id, result, pending } = await ask(HIGH);
    expect(reasonOf(() => b.respond({ requestId: id, decision: "allow", held: true }))).toBe(
      "approval_proof_required",
    );
    expect(result.value).toBeUndefined();
    b.respond({ requestId: id, decision: "allow", proof: proofFor(id) });
    await pending;
    expect(result.value?.behavior).toBe("allow");
  });

  test("Given a proof made for another request, Then it is refused; the proof for this one works", async () => {
    const { approvers, proofFor } = host(true);
    const { b, ask } = broker(approvers);
    const { id, pending } = await ask(HIGH);
    expect(
      reasonOf(() =>
        b.respond({ requestId: id, decision: "allow", proof: proofFor(id, {}, "other") }),
      ),
    ).toBe("approval_proof_required");
    b.respond({ requestId: id, decision: "allow", proof: proofFor(id) });
    await pending;
  });

  test("Given a proof for one rule list, When the allow carries another, Then it is refused", async () => {
    const { approvers, proofFor } = host(true);
    const { b, ask } = broker(approvers);
    const { id, pending } = await ask({ command: "ls" });
    const proof = proofFor(id);
    expect(
      reasonOf(() =>
        b.respond({ requestId: id, decision: "allow", updatedPermissions: [rule], proof }),
      ),
    ).toBe("approval_proof_required");
    b.respond({
      requestId: id,
      decision: "allow",
      updatedPermissions: [rule],
      proof: proofFor(id, { updatedPermissions: [rule] }),
    });
    await pending;
  });

  test("Given a key, Then a plain allow of a low-risk request and a deny of a high-risk one need no proof", async () => {
    const { approvers } = host(true);
    const { b, ask } = broker(approvers);
    const low = await ask({ command: "ls" });
    b.respond({ requestId: low.id, decision: "allow" });
    await low.pending;
    const high = await ask(HIGH);
    b.respond({ requestId: high.id, decision: "deny" });
    await high.pending;
    expect(high.result.value?.behavior).toBe("deny");
  });

  test("Given no key, Then the hold is the whole guard, as before", async () => {
    const { approvers } = host(false);
    const { b, ask } = broker(approvers);
    const { id, pending } = await ask(HIGH);
    expect(reasonOf(() => b.respond({ requestId: id, decision: "allow" }))).toBe("hold_required");
    b.respond({ requestId: id, decision: "allow", held: true });
    await pending;
  });
});

describe("approval-wiring: an external session's hook is guarded the same way", () => {
  test("Given a key, When a high-risk allow carries only the hold, Then it is refused and the hook stays held", async () => {
    const { approvers, proofFor } = host(true);
    const { permissions, ask } = external(approvers);
    const { id, answer } = ask("rm -rf build");
    expect(reasonOf(() => permissions.respond(id, "allow", { held: true }))).toBe(
      "approval_proof_required",
    );
    expect(permissions.open().length).toBe(1);
    permissions.respond(id, "allow", { proof: proofFor(id) });
    expect(JSON.parse(await answer).hookSpecificOutput.decision.behavior).toBe("allow");
  });

  test("Given no key, Then the hold passes as before", async () => {
    const { approvers } = host(false);
    const { permissions, ask } = external(approvers);
    const { id, answer } = ask("rm -rf build");
    permissions.respond(id, "allow", { held: true });
    expect(JSON.parse(await answer).hookSpecificOutput.decision.behavior).toBe("allow");
  });
});
