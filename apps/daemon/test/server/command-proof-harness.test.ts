import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdirSync, realpathSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { commandDigest, commandMessage, FEATURE_APPROVAL_HARNESS } from "@flightdeck/protocol";
import { Approvers } from "../../src/permissions/approvers.ts";
import { keyIdOf } from "../../src/permissions/domain/approval-gate.ts";
import { startServer } from "../../src/server.ts";
import { newManager } from "../support/helpers.ts";
import { FrameClient } from "../support/history-helpers.ts";

setDefaultTimeout(30_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/**
 * Issue #3507: with a device enrolled, writing a project's Claude Code setup (`project.harness.apply`) runs
 * only with the signed proof of that device over the whole request; with no device nothing changes. The folder
 * the person signs is the folder the host writes to.
 */
const TOKEN = "harness-proof-token-0123456789abcdef";

async function host(options: { enrolled?: boolean } = {}) {
  const ctx = newManager();
  const applied: Array<{ path: string; parts: readonly string[]; reformat: boolean }> = [];
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
    approvers,
    harness: {
      apply: async (path, parts, _digests, options) => {
        applied.push({ path, parts, reformat: options.reformat === true });
        return { written: ["CLAUDE.md"] };
      },
    },
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
  const project = realpathSync.native(ctx.root);
  /** The proof of the device over `project.harness.apply` and `signed`, with a nonce asked of the host. */
  const prove = async (signed: Record<string, unknown>) => {
    const ack = await client.request("approval.challenge", {
      purpose: "command",
      command: "project.harness.apply",
    });
    expect(ack.ok).toBe(true);
    const nonce = (ack.data as { nonce: string }).nonce;
    const message = commandMessage({
      keyId,
      daemonId,
      command: "project.harness.apply",
      nonce,
      payloadHash: createHash("sha256").update(commandDigest(signed)).digest("hex"),
    });
    const signature = sign("sha256", Buffer.from(message), {
      key: privateKey,
      dsaEncoding: "ieee-p1363",
    }).toString("base64");
    return { keyId, nonce, signature };
  };
  return { client, prove, applied, project };
}

const failure = (ack: Record<string, unknown>) =>
  ack.ok === false ? JSON.stringify((ack as { error?: unknown }).error) : "";
const request = (path: string, extra: Record<string, unknown> = {}) => ({
  path,
  parts: ["claudeMd", "hooks"],
  digests: { "CLAUDE.md": "d-claude", ".claude/settings.json": "d-settings" },
  confirm: true,
  ...extra,
});

describe("command-proof-harness: writing a project's setup with a device enrolled takes its signed proof (#3507)", () => {
  test("with a device enrolled, an apply without a proof is refused and nothing is written", async () => {
    const t = await host();
    const ack = await t.client.request("project.harness.apply", request(t.project));
    expect([failure(ack).includes("approval_proof_required"), t.applied.length]).toEqual([true, 0]);
  });

  test("with a device enrolled, an apply signed for this request writes the setup", async () => {
    const t = await host();
    const signed = request(t.project, { reformat: true });
    const proof = await t.prove(signed);
    const ack = await t.client.request("project.harness.apply", { ...signed, proof });
    expect([ack.ok, t.applied]).toEqual([
      true,
      [{ path: t.project, parts: ["claudeMd", "hooks"], reformat: true }],
    ]);
  });

  test("a proof is used once: the same one does not write a second time", async () => {
    const t = await host();
    const signed = request(t.project);
    const proof = await t.prove(signed);
    await t.client.request("project.harness.apply", { ...signed, proof });
    const again = await t.client.request("project.harness.apply", { ...signed, proof });
    expect([failure(again).includes("approval_proof_required"), t.applied.length]).toEqual([
      true,
      1,
    ]);
  });

  test("a proof binds the parts, the digests and the options: a request that differs in any of them is refused", async () => {
    const t = await host();
    const signed = request(t.project);
    const sent = [
      { ...signed, parts: ["claudeMd", "hooks", "permissions"] },
      { ...signed, digests: { ...signed.digests, "CLAUDE.md": "d-other" } },
      { ...signed, reformat: true },
      { ...signed, template: "shop" },
    ];
    const results: boolean[] = [];
    for (const body of sent) {
      const proof = await t.prove(signed);
      const ack = await t.client.request("project.harness.apply", { ...body, proof });
      results.push(failure(ack).includes("approval_proof_required"));
    }
    expect([results, t.applied.length]).toEqual([[true, true, true, true], 0]);
  });

  test("an apply not confirmed is refused as before, and the challenge it holds is not used up", async () => {
    const t = await host();
    const signed = request(t.project);
    const proof = await t.prove(signed);
    const { confirm: _confirm, ...unconfirmed } = signed;
    const first = await t.client.request("project.harness.apply", { ...unconfirmed, proof });
    const second = await t.client.request("project.harness.apply", { ...signed, proof });
    expect([failure(first).includes("harness_confirm"), second.ok, t.applied.length]).toEqual([
      true,
      true,
      1,
    ]);
  });

  test("a folder outside the allowed roots is refused as before, and the challenge it holds is not used up", async () => {
    const t = await host();
    const proof = await t.prove(request("/elsewhere"));
    const ack = await t.client.request("project.harness.apply", {
      ...request("/elsewhere"),
      proof,
    });
    expect([failure(ack).includes("cwd_outside_roots"), t.applied.length]).toEqual([true, 0]);
  });

  test("a link signed as one folder that leads to another is refused, naming the folder it is", async () => {
    const t = await host();
    const target = join(t.project, "real");
    mkdirSync(target);
    const link = join(t.project, "link");
    symlinkSync(target, link);
    const signed = request(link);
    const proof = await t.prove(signed);
    const ack = await t.client.request("project.harness.apply", { ...signed, proof });
    expect([
      failure(ack).includes("harness_path_differs"),
      failure(ack).includes(target),
      t.applied.length,
    ]).toEqual([true, true, 0]);
  });

  test("with no device enrolled, an apply with confirm writes as before and carries no proof", async () => {
    const t = await host({ enrolled: false });
    const ack = await t.client.request("project.harness.apply", request(t.project));
    expect([ack.ok, t.applied.length]).toEqual([true, 1]);
  });

  test("the host announces the harness proof", async () => {
    const t = await host();
    const info = await t.client.data<{ features?: string[] }>("host.info", {});
    expect(info?.features).toContain(FEATURE_APPROVAL_HARNESS);
  });

  test("a challenge for the command is one the host gives", async () => {
    const t = await host();
    const ack = await t.client.request("approval.challenge", {
      purpose: "command",
      command: "project.harness.apply",
    });
    expect(ack.ok).toBe(true);
  });
});
