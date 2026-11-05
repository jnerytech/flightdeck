import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ProjectLoad, ProjectTrustState, ProjectTrustStates } from "@flightdeck/protocol";
import { startDaemon } from "../src/main.ts";
import { tempDir, workspace } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

const TOKEN = "trust-commands-token-0123456789abcdef";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function daemon() {
  const dir = tempDir();
  const { root, project } = workspace();
  const file = join(dir, "config.json");
  writeFileSync(
    file,
    JSON.stringify({
      port: 0,
      token: TOKEN,
      dataDir: join(dir, "data"),
      allowedRoots: [root],
      history: { roots: [join(dir, "nada")] },
    }),
  );
  const running = await startDaemon(
    { command: "start", config: file, runtime: "fake" },
    {},
    { log: () => {}, error: () => {} },
  );
  cleanups.push(() => running.stop());
  const client = new FrameClient(`ws://127.0.0.1:${new URL(running.url).port}/v1/ws`);
  cleanups.push(() => client.close());
  await client.request("hello", { token: TOKEN, client: "t" });
  const refusal = async (type: string, payload: unknown) => {
    const ack = await client.request(type, payload);
    const error = ack.error as { code?: string; reason?: string } | undefined;
    return ack.ok === true ? "ok" : `${error?.code}/${error?.reason}`;
  };
  return { client, root, project, refusal };
}

describe("trust-commands: the person sees what a project would load and decides (#196)", () => {
  test("host.info announces projectTrust, and a project the daemon never saw starts untrusted", async () => {
    const { client, project } = await daemon();
    const info = await client.data<{ features?: string[] }>("host.info", {});
    expect(info?.features).toContain("projectTrust");
    const state = await client.data<ProjectTrustStates>("project.trust.state", {
      paths: [project],
    });
    expect(state?.items).toEqual([{ path: project, trusted: false, via: null }]);
  });

  test("trusting is explicit, covers the folders inside, and revoking goes through the record that granted it", async () => {
    const { client, project } = await daemon();
    const set = await client.data<ProjectTrustState>("project.trust.set", {
      path: project,
      trusted: true,
    });
    expect(set).toEqual({ path: project, trusted: true, via: project });
    const inner = join(project, "packages", "api");
    mkdirSync(inner, { recursive: true });
    const state = await client.data<ProjectTrustStates>("project.trust.state", {
      paths: [inner, join(project, "..")],
    });
    expect(state?.items.map((i) => [i.trusted, i.via])).toEqual([
      [true, project],
      [false, null],
    ]);
    // Revoking a folder inside does nothing by itself: the grant is the parent's.
    const still = await client.data<ProjectTrustState>("project.trust.set", {
      path: inner,
      trusted: false,
    });
    expect(still).toEqual({ path: inner, trusted: true, via: project });
    const gone = await client.data<ProjectTrustState>("project.trust.set", {
      path: project,
      trusted: false,
    });
    expect(gone).toEqual({ path: project, trusted: false, via: null });
  });

  test("inspect lists what the project would load, and never runs it", async () => {
    const { client, project } = await daemon();
    const marker = join(project, "RAN");
    mkdirSync(join(project, ".claude"), { recursive: true });
    writeFileSync(
      join(project, ".claude", "settings.json"),
      JSON.stringify({
        hooks: { SessionStart: [{ hooks: [{ type: "command", command: `touch ${marker}` }] }] },
        env: { SECRET: "do-not-show" },
      }),
    );
    const load = await client.data<ProjectLoad>("project.trust.inspect", { path: project });
    expect(load?.hooks).toEqual([
      { event: "SessionStart", file: ".claude/settings.json", commands: [`touch ${marker}`] },
    ]);
    expect(load?.envKeys).toEqual(["SECRET"]);
    expect(JSON.stringify(load)).not.toContain("do-not-show");
    expect(await Bun.file(marker).exists()).toBe(false);
  });

  test("a folder outside the allowed roots is refused with a reason, for all three commands", async () => {
    const { refusal } = await daemon();
    const outside = tempDir("fd-outside-");
    for (const [type, payload] of [
      ["project.trust.state", { paths: [outside] }],
      ["project.trust.inspect", { path: outside }],
      ["project.trust.set", { path: outside, trusted: true }],
    ] as const) {
      expect([type, await refusal(type, payload)]).toEqual([
        type,
        "forbidden_cwd/cwd_outside_roots",
      ]);
    }
  });
});
