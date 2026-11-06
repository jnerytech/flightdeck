import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SecretScanner } from "@flightdeck/protocol";
import { FlightdeckError } from "../src/errors.ts";
import {
  type TeleportDeps,
  TeleportPackages,
  type TeleportSession,
} from "../src/teleport/package.ts";

/**
 * Issue #100, slice 1: the source side of a teleport. An idle Claude Code session's transcript is
 * copied into a private package, described by a manifest (sizes, sha256, the lines that look like
 * secrets, never the secrets), and read back in chunks; the package goes after a time limit.
 */
const ID = "0b6f5c2e-6f0a-4c39-9a51-7c4f1d2e3a4b";
const TOKEN = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";
const LINES = [
  JSON.stringify({ type: "user", message: { content: "fix the login" } }),
  JSON.stringify({ type: "assistant", message: { content: "done" } }),
];

const folders: string[] = [];
afterEach(async () => {
  for (const dir of folders.splice(0)) await rm(dir, { recursive: true, force: true });
});

const SESSION: TeleportSession = {
  id: "s1",
  cwd: "/work/app",
  status: "idle",
  runtime: "claude",
  permissionMode: "acceptEdits",
  model: "claude-sonnet-5-5",
  claudeSessionId: ID,
  persona: { id: "qa", name: "QA", icon: null },
};

async function setup(
  options: {
    session?: Partial<TeleportSession>;
    team?: boolean;
    lines?: string[];
    transcript?: "file" | "link" | "outside" | "none" | "gone";
    maxBytes?: number;
    chunkBytes?: number;
  } = {},
) {
  const base = await mkdtemp(join(tmpdir(), "teleport-"));
  folders.push(base);
  const history = join(base, "projects");
  const project = join(history, "-work-app");
  await mkdir(project, { recursive: true });
  const outside = join(base, "outside.json");
  await writeFile(outside, '{"secret":"credentials"}\n');
  const file = join(project, `${ID}.jsonl`);
  const kind = options.transcript ?? "file";
  if (kind === "file") await writeFile(file, `${(options.lines ?? LINES).join("\n")}\n`);
  if (kind === "link") await symlink(outside, file);
  const timers: Array<{ fn: () => void; ms: number; live: boolean }> = [];
  const logs: string[] = [];
  let ids = 0;
  const deps: TeleportDeps = {
    session: (id) => {
      if (id !== "s1") throw new FlightdeckError("not_found", "no session", "session_not_found");
      return { ...SESSION, ...options.session };
    },
    inTeam: () => options.team ?? false,
    transcriptOf: () => {
      if (kind === "none") return null;
      if (kind === "gone") return join(history, "-gone", `${ID}.jsonl`);
      return kind === "outside" ? outside : file;
    },
    // A root that does not exist on this host is skipped.
    historyRoots: [join(base, "missing-root"), history],
    dir: join(base, "teleport"),
    scan: (text) => new SecretScanner().scan(text),
    now: () => Date.parse("2026-11-06T12:00:00.000Z"),
    newId: () => `pkg-${++ids}`,
    timers: {
      setTimeout: (fn, ms) => {
        const timer = { fn, ms, live: true };
        timers.push(timer);
        return timer;
      },
      clearTimeout: (timer) => {
        (timer as { live: boolean }).live = false;
      },
    },
    log: (line) => void logs.push(line),
    ...(options.maxBytes ? { maxBytes: options.maxBytes } : {}),
    ...(options.chunkBytes ? { chunkBytes: options.chunkBytes } : {}),
  };
  const packages = new TeleportPackages(deps);
  return { packages, deps, base, file, timers, logs };
}

const reason = (run: () => Promise<unknown>) =>
  run().then(
    () => "no refusal",
    (error: unknown) => (error as FlightdeckError).reason ?? String(error),
  );

const sha256 = (text: string) => new Bun.CryptoHasher("sha256").update(text).digest("hex");

describe("teleport-package: an idle session's transcript becomes a package (#100)", () => {
  test("the manifest names the session, its settings and the transcript's size and sha256", async () => {
    const { packages, deps } = await setup();
    const manifest = await packages.prepare("s1");
    const text = `${LINES.join("\n")}\n`;
    const dir = join(deps.dir, "pkg-1");
    const [dirMode, fileMode] = await Promise.all([
      stat(dir).then(
        (s) => s.mode & 0o777,
        () => "missing",
      ),
      stat(join(dir, "transcript")).then(
        (s) => s.mode & 0o777,
        () => "missing",
      ),
    ]);
    expect([manifest, dirMode, fileMode]).toEqual([
      {
        id: "pkg-1",
        sessionId: "s1",
        claudeSessionId: ID,
        cwd: "/work/app",
        model: "claude-sonnet-5-5",
        permissionMode: "acceptEdits",
        persona: "qa",
        expiresAt: "2026-11-06T12:30:00.000Z",
        parts: [{ name: "transcript", size: Buffer.byteLength(text), sha256: sha256(text) }],
        secrets: { lines: 0, labels: [] },
      },
      0o700,
      0o600,
    ]);
  });

  test("a session that is working, in a team, on another runtime or with no transcript is refused", async () => {
    const reasons = [];
    for (const options of [
      { session: { status: "running" as const } },
      { session: { status: "awaiting_permission" as const } },
      { team: true },
      { session: { runtime: "opencode" as const } },
      { session: { claudeSessionId: null } },
      { transcript: "none" as const },
    ]) {
      const { packages } = await setup(options);
      reasons.push(await reason(() => packages.prepare("s1")));
    }
    expect(reasons).toEqual([
      "teleport_busy",
      "teleport_busy",
      "teleport_team",
      "teleport_runtime",
      "teleport_no_transcript",
      "teleport_no_transcript",
    ]);
  });

  test("a transcript that is a link, lies outside the history, has a bad id or a folder that is gone is never read", async () => {
    const reasons = [];
    const copied = [];
    for (const options of [
      { transcript: "link" as const },
      { transcript: "outside" as const },
      { session: { claudeSessionId: "../../.credentials" } },
      { transcript: "gone" as const },
    ]) {
      const { packages, deps } = await setup(options);
      reasons.push(await reason(() => packages.prepare("s1")));
      copied.push(await readdir(deps.dir).catch(() => []));
    }
    expect([reasons, copied]).toEqual([
      [
        "teleport_unsafe_transcript",
        "teleport_unsafe_transcript",
        "teleport_unsafe_transcript",
        "teleport_unsafe_transcript",
      ],
      [[], [], [], []],
    ]);
  });

  test("a transcript over the limit is refused with the limit", async () => {
    const { packages } = await setup({ maxBytes: 10 });
    const error = await packages.prepare("s1").then(
      () => null,
      (e: FlightdeckError) => [e.reason, e.params],
    );
    expect(error).toEqual(["teleport_too_large", { max: 10 }]);
  });

  test("lines that look like secrets are counted and labeled; the secret is in no manifest or log", async () => {
    const line = JSON.stringify({ type: "user", message: { content: `token ${TOKEN}` } });
    const { packages, logs } = await setup({ lines: [line, ...LINES] });
    const manifest = await packages.prepare("s1");
    expect([
      manifest.secrets,
      JSON.stringify(manifest).includes(TOKEN),
      logs.join("\n").includes(TOKEN),
    ]).toEqual([{ lines: 1, labels: new SecretScanner().scan(line) }, false, false]);
  });
});

describe("teleport-package: the package is read in chunks and does not outlive its time (#100)", () => {
  test("chunks put back together are the transcript, and the last one says so", async () => {
    const { packages } = await setup({ chunkBytes: 16 });
    const manifest = await packages.prepare("s1");
    const parts: string[] = [];
    let offset = 0;
    let eof = false;
    while (!eof) {
      const chunk = await packages.read(manifest.id, "transcript", offset);
      parts.push(Buffer.from(chunk.data, "base64").toString("utf8"));
      offset = chunk.next;
      eof = chunk.eof;
    }
    expect([parts.join(""), parts.length > 1]).toEqual([`${LINES.join("\n")}\n`, true]);
  });

  test("an unknown package, an unknown part or an offset past the end is refused", async () => {
    const { packages } = await setup();
    const manifest = await packages.prepare("s1");
    const size = manifest.parts[0]?.size ?? 0;
    expect([
      await reason(() => packages.read("pkg-9", "transcript", 0)),
      await reason(() => packages.read(manifest.id, "../transcript", 0)),
      await reason(() => packages.read(manifest.id, "transcript", size + 1)),
      await reason(() => packages.read(manifest.id, "transcript", -1)),
    ]).toEqual(["teleport_not_found", "teleport_not_found", "request_invalid", "request_invalid"]);
  });

  test("the package goes when its time is up, when it is cancelled and when the daemon starts", async () => {
    const { packages, deps, timers } = await setup();
    const first = await packages.prepare("s1");
    const second = await packages.prepare("s1");
    const timer = timers[0];
    timer?.fn();
    await packages.idle();
    const expired = await reason(() => packages.read(first.id, "transcript", 0));
    await packages.cancel(second.id);
    const left = await readdir(deps.dir).catch(() => ["no folder"]);
    // A package left by an earlier run of the daemon is swept when it starts.
    await mkdir(join(deps.dir, "stale"), { recursive: true }); // also makes the folder
    await writeFile(join(deps.dir, "stale", "transcript"), "old");
    await new TeleportPackages(deps).start();
    expect([
      timer?.ms,
      expired,
      timers[1]?.live,
      left,
      await readdir(deps.dir).catch(() => ["no folder"]),
    ]).toEqual([1_800_000, "teleport_not_found", false, [], []]);
  });
});
