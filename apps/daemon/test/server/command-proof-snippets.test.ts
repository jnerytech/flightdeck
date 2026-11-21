import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { commandDigest, commandMessage } from "@flightdeck/protocol";
import { Approvers } from "../../src/permissions/approvers.ts";
import { keyIdOf } from "../../src/permissions/domain/approval-gate.ts";
import { startServer } from "../../src/server.ts";
import { SecretScanner } from "../../src/snippets/domain/model.ts";
import { Snippets } from "../../src/snippets/store.ts";
import { EventStore } from "../../src/store/event-store.ts";
import { newManager, tempDir } from "../support/helpers.ts";
import { FrameClient } from "../support/history-helpers.ts";

setDefaultTimeout(30_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/**
 * Issue #3647: with a device enrolled, trusting a project's `.flightdeck/snippets.yaml` runs only with the
 * signed proof of that device over the project and the hash of the file; with no device nothing changes.
 */
const TOKEN = "snippets-proof-token-0123456789abcdef";
const FILE = '- name: deploy\n  type: command\n  run: "make deploy"\n';
const OTHER_FILE = '- name: deploy\n  type: command\n  run: "make deploy-all"\n';

async function host(options: { enrolled?: boolean; approvers?: boolean } = {}) {
  const ctx = newManager();
  const root = realpathSync.native(tempDir("fd-snip-proof-"));
  const project = join(root, "project");
  mkdirSync(join(project, ".flightdeck"), { recursive: true });
  const file = join(project, ".flightdeck", "snippets.yaml");
  writeFileSync(file, FILE);
  const library = new Snippets({
    db: new EventStore(":memory:").db,
    allowedRoots: [root],
    scanner: new SecretScanner(),
    now: () => Date.parse("2026-11-21T12:00:00Z"),
  });
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
    ...(options.approvers === false ? {} : { approvers }),
    snippets: { library },
    hostName: "h",
    bind: "127.0.0.1",
    port: 0,
    token: TOKEN,
    allowedRoots: [root],
  });
  cleanups.push(() => server.stop());
  const client = new FrameClient(server.url);
  cleanups.push(() => client.close());
  await client.request("hello", { token: TOKEN, client: "flightdeck-app" });
  const daemonId = approvers.list().daemonId;
  /** The proof of the device over `signed`, with a nonce asked of the host. */
  const prove = async (signed: Record<string, unknown>) => {
    const ack = await client.request("approval.challenge", {
      purpose: "command",
      command: "snippets.trust",
    });
    expect(ack.ok).toBe(true);
    const nonce = (ack.data as { nonce: string }).nonce;
    const message = commandMessage({
      keyId,
      daemonId,
      command: "snippets.trust",
      nonce,
      payloadHash: createHash("sha256").update(commandDigest(signed)).digest("hex"),
    });
    const signature = sign("sha256", Buffer.from(message), {
      key: privateKey,
      dsaEncoding: "ieee-p1363",
    }).toString("base64");
    return { keyId, nonce, signature };
  };
  const hash = async (path = project) =>
    ((await library.list({ projectPath: path })).file as { hash: string }).hash;
  const trusted = async () =>
    ((await library.list({ projectPath: project })).file as { trusted: boolean }).trusted;
  return { client, prove, hash, trusted, project, root, file, library };
}

const failure = (ack: Record<string, unknown>) =>
  ack.ok === false ? JSON.stringify((ack as { error?: unknown }).error) : "";

describe("command-proof-snippets: trusting a project's snippet file with a device enrolled takes its signed proof (#3647)", () => {
  test("without a proof the trust is refused and the file stays untrusted", async () => {
    const t = await host();
    const ack = await t.client.request("snippets.trust", {
      projectPath: t.project,
      hash: await t.hash(),
    });
    expect([failure(ack).includes("approval_proof_required"), await t.trusted()]).toEqual([
      true,
      false,
    ]);
  });

  test("a proof signed for this project and this hash trusts the file", async () => {
    const t = await host();
    const signed = { projectPath: t.project, hash: await t.hash() };
    const ack = await t.client.request("snippets.trust", {
      ...signed,
      proof: await t.prove(signed),
    });
    expect([ack.ok, await t.trusted()]).toEqual([true, true]);
  });

  test("a proof covers the hash: one signed for another hash does not trust this file", async () => {
    const t = await host();
    const proof = await t.prove({ projectPath: t.project, hash: "0".repeat(64) });
    const ack = await t.client.request("snippets.trust", {
      projectPath: t.project,
      hash: await t.hash(),
      proof,
    });
    expect([failure(ack).includes("approval_proof_required"), await t.trusted()]).toEqual([
      true,
      false,
    ]);
  });

  test("a proof covers the project: one signed for another folder does not trust this one", async () => {
    const t = await host();
    const hash = await t.hash();
    const proof = await t.prove({ projectPath: join(t.root, "elsewhere"), hash });
    const ack = await t.client.request("snippets.trust", {
      projectPath: t.project,
      hash,
      proof,
    });
    expect([failure(ack).includes("approval_proof_required"), await t.trusted()]).toEqual([
      true,
      false,
    ]);
  });

  test("a file that changed since it was shown is refused before the proof is checked, so the challenge is not spent", async () => {
    const t = await host();
    // The person signs the hash of a version the host does not have yet.
    writeFileSync(t.file, OTHER_FILE);
    const future = await t.hash();
    writeFileSync(t.file, FILE);
    const signed = { projectPath: t.project, hash: future };
    const proof = await t.prove(signed);
    const stale = await t.client.request("snippets.trust", { ...signed, proof });
    expect([failure(stale).includes("snippet_file_changed"), await t.trusted()]).toEqual([
      true,
      false,
    ]);
    // The host now has that version: the same proof, still unspent, trusts it.
    writeFileSync(t.file, OTHER_FILE);
    const ack = await t.client.request("snippets.trust", { ...signed, proof });
    expect([ack.ok, await t.trusted()]).toEqual([true, true]);
  });

  test("a proof is spent once: the same signed trust cannot run twice", async () => {
    const t = await host();
    const signed = { projectPath: t.project, hash: await t.hash() };
    const proof = await t.prove(signed);
    const first = await t.client.request("snippets.trust", { ...signed, proof });
    const second = await t.client.request("snippets.trust", { ...signed, proof });
    expect([first.ok, failure(second).includes("approval_proof")]).toEqual([true, true]);
  });

  test("a folder that resolves to another one is refused with the folder it is, before any proof", async () => {
    const t = await host();
    const link = join(t.root, "link");
    symlinkSync(t.project, link);
    const signed = { projectPath: link, hash: await t.hash() };
    const ack = await t.client.request("snippets.trust", {
      ...signed,
      proof: await t.prove(signed),
    });
    expect([
      failure(ack).includes("trust_path_differs"),
      failure(ack).includes(t.project),
      await t.trusted(),
    ]).toEqual([true, true, false]);
  });

  test("with no device enrolled the trust needs no proof, as before", async () => {
    const t = await host({ enrolled: false });
    const ack = await t.client.request("snippets.trust", {
      projectPath: t.project,
      hash: await t.hash(),
    });
    expect([ack.ok, await t.trusted()]).toEqual([true, true]);
  });

  test("host.info announces the check only when the host can check proofs and keeps snippets", async () => {
    const featuresOf = async (approvers: boolean) => {
      const t = await host({ approvers });
      return (await t.client.data<{ features: string[] }>("host.info", {}))?.features ?? [];
    };
    expect([
      (await featuresOf(true)).includes("approval-snippets"),
      (await featuresOf(false)).includes("approval-snippets"),
    ]).toEqual([true, false]);
  });
});
