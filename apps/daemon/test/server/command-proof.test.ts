import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { commandDigest, commandMessage, FEATURE_APPROVAL_COMMAND } from "@flightdeck/protocol";
import { type FakeRule, installFakeCli } from "../../../../scripts/test/fake-cli.ts";
import { Approvers } from "../../src/permissions/approvers.ts";
import { keyIdOf } from "../../src/permissions/domain/approval-gate.ts";
import { startServer } from "../../src/server.ts";
import { newBoard } from "../support/board-helpers.ts";
import { FrameClient } from "../support/history-helpers.ts";

setDefaultTimeout(30_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/**
 * Issue #3453: with a device enrolled, `card.pr.merge` runs only with the signed proof of that device over
 * the pull request, its head and the method; the refusal comes before the domain is asked anything.
 */
const TOKEN = "command-proof-token-0123456789abcdef";
const PR_URL = "https://github.com/acme/repo/pull/9";
const SEEN = "a".repeat(40);
const MERGED = {
  args: ["view", "state,statusCheckRollup,mergeStateStatus,reviewDecision,createdAt"],
  stdout: JSON.stringify({ state: "MERGED" }),
};
const HEAD: FakeRule = {
  args: ["view", "headRefOid"],
  stdout: JSON.stringify({ headRefOid: SEEN }),
};

async function host(options: { enrolled?: boolean } = {}) {
  const gh = installFakeCli("gh", [HEAD, { args: ["pr", "merge"] }, MERGED]);
  cleanups.push(gh.restore);
  const ctx = newBoard();
  cleanups.push(() => ctx.board.stop());
  const project = await ctx.board.addProject({
    path: ctx.repo,
    prProvider: "github",
    promptTemplate: "",
  });
  const card = ctx.board.createCard(project.id, { title: "Sum numbers", description: "add them" });
  ctx.store.db
    .query("UPDATE cards SET pr_url = ?, pr_state = 'open', board_column = 'review' WHERE id = ?")
    .run(PR_URL, card.id);
  let n = 0;
  const approvers = new Approvers(ctx.store.db, {
    now: () => new Date(),
    mono: () => performance.now(),
    random: () => `nonce-${++n}`,
  });
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const spki = publicKey.export({ type: "spki", format: "der" }).toString("base64");
  const keyId = keyIdOf(spki);
  if (options.enrolled !== false) {
    approvers.store.add({
      keyId,
      publicKey: spki,
      name: "phone",
      client: "app",
      address: "127.0.0.1",
      enrolledAt: new Date().toISOString(),
    });
  }
  const server = startServer({
    manager: ctx.manager,
    board: ctx.board,
    approvers,
    hostName: "h",
    bind: "127.0.0.1",
    port: 0,
    token: TOKEN,
    allowedRoots: [ctx.root],
  });
  cleanups.push(() => server.stop());
  const client = new FrameClient(server.url);
  cleanups.push(() => client.close());
  await client.request("hello", { token: TOKEN, client: "flightdeck-app" });
  const daemonId = approvers.list().daemonId;
  const payload = {
    cardId: card.id,
    method: "squash",
    confirm: true,
    prUrl: PR_URL,
    headSha: SEEN,
  };
  /** The proof of a device over `command` and `signed`, with a nonce asked of the host. */
  const prove = async (command: string, signed: Record<string, unknown>) => {
    const ack = await client.request("approval.challenge", { purpose: "command", command });
    expect(ack.ok).toBe(true);
    const nonce = (ack.data as { nonce: string }).nonce;
    const message = commandMessage({
      keyId,
      daemonId,
      command,
      nonce,
      payloadHash: createHash("sha256").update(commandDigest(signed)).digest("hex"),
    });
    const signature = sign("sha256", Buffer.from(message), {
      key: privateKey,
      dsaEncoding: "ieee-p1363",
    }).toString("base64");
    return { keyId, nonce, signature };
  };
  const merges = () => gh.calls().filter((args) => args.includes("merge"));
  return { client, payload, prove, merges, cardId: card.id };
}

const failure = (ack: Record<string, unknown>) =>
  ack.ok === false ? JSON.stringify((ack as { error?: unknown }).error) : "";

describe("command-proof: a merge with a device enrolled takes its signed proof (#3453)", () => {
  test("a card's pull request address and head are read live for the app to show and sign", async () => {
    const t = await host();
    expect(await t.client.data("card.pr.head", { cardId: t.cardId })).toEqual({
      prUrl: PR_URL,
      headSha: SEEN,
    });
  });

  test("with a device enrolled, a merge without a proof is refused and nothing is merged", async () => {
    const t = await host();
    const ack = await t.client.request("card.pr.merge", t.payload);
    expect([failure(ack).includes("approval_proof_required"), t.merges()]).toEqual([true, []]);
  });

  test("with a device enrolled, a merge signed for this payload merges the head that was signed", async () => {
    const t = await host();
    const proof = await t.prove("card.pr.merge", t.payload);
    const ack = await t.client.request("card.pr.merge", { ...t.payload, proof });
    expect([ack.ok, t.merges()]).toEqual([
      true,
      [["pr", "merge", PR_URL, "--squash", "--match-head-commit", SEEN]],
    ]);
  });

  test("a proof signed for one method does not merge with another", async () => {
    const t = await host();
    const proof = await t.prove("card.pr.merge", { ...t.payload, method: "squash" });
    const ack = await t.client.request("card.pr.merge", { ...t.payload, method: "merge", proof });
    expect([failure(ack).includes("approval_proof_required"), t.merges()]).toEqual([true, []]);
  });

  test("with a device enrolled, a payload without the address and the head is refused even with a proof", async () => {
    const t = await host();
    const { prUrl: _prUrl, headSha: _headSha, ...bare } = t.payload;
    const proof = await t.prove("card.pr.merge", bare);
    const ack = await t.client.request("card.pr.merge", { ...bare, proof });
    expect([failure(ack).includes("approval_proof_required"), t.merges()]).toEqual([true, []]);
  });

  test("a merge not confirmed is refused as before, and the challenge it holds is not used up", async () => {
    const t = await host();
    const unconfirmed = { ...t.payload, confirm: false };
    const proof = await t.prove("card.pr.merge", unconfirmed);
    const first = await t.client.request("card.pr.merge", { ...unconfirmed, proof });
    const second = await t.client.request("card.pr.merge", { ...t.payload, proof });
    expect([
      failure(first).includes("merge_confirm"),
      failure(second).includes("approval_proof_required"),
    ]).toEqual([true, true]);
  });

  test("with no device enrolled, a merge runs as before and carries no proof", async () => {
    const t = await host({ enrolled: false });
    const ack = await t.client.request("card.pr.merge", t.payload);
    expect([ack.ok, t.merges().length]).toEqual([true, 1]);
  });

  test("the host announces the command proof", async () => {
    const t = await host();
    const info = await t.client.data<{ features?: string[] }>("host.info", {});
    expect(info?.features).toContain(FEATURE_APPROVAL_COMMAND);
  });
});
