import { describe, expect, test } from "bun:test";
import { parseServerMessage, VaultRequestFrame } from "@flightdeck/protocol";
import { decideRequest, type Requester, requesterOf } from "../src/vault/requests.ts";

describe("cofre-solicitante", () => {
  test("um pedido do daemon é claude, automation ou workflow; qualquer outra coisa, inclusive you, é desconhecido", () => {
    for (const ok of ["claude", "automation", "workflow"] as Requester[]) {
      expect(requesterOf(ok)).toBe(ok);
    }
    for (const odd of ["you", "YOU", " you", "admin", "", undefined, null, 42, {}, ["you"]]) {
      expect(requesterOf(odd)).toBe("unknown");
    }
  });

  test("o pedido do daemon vai ao app, que decide; quem diz ser you ou não se conhece é negado", () => {
    for (const requester of ["claude", "automation", "workflow", "you", undefined, "root"]) {
      const decision = decideRequest({ requester });
      const daemon = ["claude", "automation", "workflow"].includes(requester as string);
      expect(decision.granted).toBe(daemon);
      expect(decision.reason).toContain("app");
      expect(decision.requester).toBe(daemon ? (requester as Requester) : "unknown");
    }
  });

  test("o frame vault.request só aceita os solicitantes do daemon: com you ele não é um pedido válido", () => {
    const frame = { type: "vault.request", requestId: "r1", secretId: "s1", purpose: "ssh" };
    for (const requester of ["claude", "automation", "workflow"]) {
      expect(VaultRequestFrame.safeParse({ ...frame, requester }).success).toBe(true);
      expect(parseServerMessage(JSON.stringify({ ...frame, requester })).type).toBe(
        "vault.request",
      );
    }
    expect(VaultRequestFrame.safeParse({ ...frame, requester: "you" }).success).toBe(false);
    expect(VaultRequestFrame.safeParse(frame).success).toBe(false);
  });

  test("o frame vault.used leva quem usou e o que fez, nunca o valor", () => {
    const used = parseServerMessage(
      JSON.stringify({
        type: "vault.used",
        secretId: "s1",
        purpose: "ssh",
        requester: "you",
        action: "echo",
        at: "2026-10-05T12:00:00.000Z",
      }),
    );
    expect(used).toMatchObject({ type: "vault.used", requester: "you" });
    expect(Object.keys(used).sort()).toEqual(
      ["action", "at", "purpose", "requester", "secretId", "type"].sort(),
    );
  });
});
