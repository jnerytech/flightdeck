import { describe, expect, test } from "bun:test";
import { NONCE_TTL_MS, NonceBook } from "../../src/permissions/domain/nonce-book.ts";

function book(caps = { approve: 4, other: 2 }, perConnection = 3) {
  const clock = { at: 1_000 };
  let n = 0;
  const nonces = new NonceBook({
    mono: () => clock.at,
    random: () => `n${++n}`,
    caps,
    perConnection,
  });
  return { nonces, clock };
}

const busy = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return (error as { reason?: string }).reason;
  }
  return undefined;
};

describe("nonce-book: a challenge is good once, for one request, for sixty seconds (#3439)", () => {
  test("Given an issued nonce, When it is taken, Then it is ok once and unknown after", () => {
    const { nonces } = book();
    const nonce = nonces.issue("approve", "r1", 1);
    expect(nonces.take(nonce, "approve", "r1")).toBe("ok");
    expect(nonces.take(nonce, "approve", "r1")).toBe("unknown");
  });

  test("Given a nonce, When it is taken for another request or purpose, Then it is unknown and the right one still works", () => {
    const { nonces } = book();
    const nonce = nonces.issue("approve", "r1", 1);
    expect(nonces.take(nonce, "approve", "r2")).toBe("unknown");
    expect(nonces.take(nonce, "enroll")).toBe("unknown");
    expect(nonces.take("never-issued", "approve", "r1")).toBe("unknown");
    expect(nonces.take(nonce, "approve", "r1")).toBe("ok");
  });

  test("Given a nonce older than the life, When it is taken, Then it is expired and then gone", () => {
    const { nonces, clock } = book();
    const nonce = nonces.issue("approve", "r1", 1);
    clock.at += NONCE_TTL_MS + 1;
    expect(nonces.take(nonce, "approve", "r1")).toBe("expired");
    expect(nonces.take(nonce, "approve", "r1")).toBe("unknown");
  });

  test("Given a nonce just inside its life, Then it is still ok", () => {
    const { nonces, clock } = book();
    const nonce = nonces.issue("approve", "r1", 1);
    clock.at += NONCE_TTL_MS - 1;
    expect(nonces.take(nonce, "approve", "r1")).toBe("ok");
  });

  test("Given two nonces for one request, Then both are live and each is used once", () => {
    const { nonces } = book();
    const a = nonces.issue("approve", "r1", 1);
    const b = nonces.issue("approve", "r1", 1);
    expect(a).not.toBe(b);
    expect(nonces.take(b, "approve", "r1")).toBe("ok");
    expect(nonces.take(a, "approve", "r1")).toBe("ok");
  });
});

describe("nonce-book: a full bucket gives up what is dead first, and a connection cannot push out another's", () => {
  test("Given a full approval bucket of live nonces from other connections, Then the next is refused as busy", () => {
    const { nonces } = book({ approve: 3, other: 2 }, 3);
    for (let i = 0; i < 3; i++) nonces.issue("approve", "r", 1 + i);
    expect(busy(() => nonces.issue("approve", "r", 9))).toBe("approval_challenge_busy");
  });

  test("Given a full bucket with an expired nonce, Then the new one takes its place", () => {
    const { nonces, clock } = book({ approve: 2, other: 2 }, 3);
    const old = nonces.issue("approve", "r", 1);
    clock.at += NONCE_TTL_MS + 1;
    nonces.issue("approve", "r", 2);
    const fresh = nonces.issue("approve", "r", 3);
    expect(nonces.take(old, "approve", "r")).toBe("unknown");
    expect(nonces.take(fresh, "approve", "r")).toBe("ok");
  });

  test("Given one connection over its quota, Then its oldest nonce is dropped, not another connection's", () => {
    const { nonces } = book({ approve: 10, other: 2 }, 2);
    const mine1 = nonces.issue("approve", "r", 1);
    const theirs = nonces.issue("approve", "r", 2);
    const mine2 = nonces.issue("approve", "r", 1);
    const mine3 = nonces.issue("approve", "r", 1);
    expect(nonces.take(mine1, "approve", "r")).toBe("unknown");
    expect(nonces.take(theirs, "approve", "r")).toBe("ok");
    expect(nonces.take(mine2, "approve", "r")).toBe("ok");
    expect(nonces.take(mine3, "approve", "r")).toBe("ok");
  });

  test("Given the approval bucket full, Then an enrollment nonce still comes: the buckets are apart", () => {
    const { nonces } = book({ approve: 1, other: 1 }, 3);
    nonces.issue("approve", "r", 1);
    expect(nonces.issue("enroll", undefined, 2)).not.toBe("");
    expect(busy(() => nonces.issue("revoke", undefined, 3))).toBe("approval_challenge_busy");
  });
});

describe("nonce-book: no one connection can take a whole bucket (#3439)", () => {
  test("Given the default limits, When one connection keeps asking for enrollment challenges, Then another connection still gets one", () => {
    let n = 0;
    const nonces = new NonceBook({ mono: () => 1_000, random: () => `d${++n}` });
    for (let i = 0; i < 40; i++) nonces.issue("enroll", undefined, 1);
    expect(busy(() => nonces.issue("enroll", undefined, 2))).toBeUndefined();
    expect(busy(() => nonces.issue("revoke", undefined, 3))).toBeUndefined();
  });
});
