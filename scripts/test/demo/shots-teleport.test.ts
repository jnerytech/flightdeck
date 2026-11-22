import { describe, expect, test } from "bun:test";
import {
  TeleportManifestSchema,
  type TeleportOutcome,
  type TeleportRequest,
  teleportSession,
  teleportSummary,
} from "@flightdeck/protocol";
import type { DemoIds } from "../../demo-seed.ts";
import { teleportShots } from "../../lib/shots/table-teleport.ts";
import { teleportRewriter, teleportScript } from "../../lib/shots/teleport-frames.ts";

const IDS = {} as DemoIds;

/** What the page's socket tells the app for a request the print answers for, or null when it lets it go. */
const answerTo = (rewriter: ReturnType<typeof teleportRewriter>, type: string, payload = {}) => {
  const frame = rewriter.answer?.(JSON.stringify({ id: "q1", type, payload }));
  return frame === undefined ? null : (JSON.parse(frame) as Record<string, unknown>);
};

/** A host's command channel that asks the print's rewriter, as the page does. */
const channel = (rewriter: ReturnType<typeof teleportRewriter>): TeleportRequest =>
  ((type: string, payload: unknown) => {
    const ack = answerTo(rewriter, type, payload as object);
    return ack?.ok === true
      ? Promise.resolve(ack.data)
      : Promise.reject(new Error(`the print did not answer ${type}`));
  }) as TeleportRequest;

/** The whole move, as the app runs it, over the print's answers alone. */
const move = (rewriter: ReturnType<typeof teleportRewriter>, say: (text: string) => void) =>
  teleportSession({
    source: channel(rewriter),
    target: channel(rewriter),
    sessionId: "print-session",
    repo: "/srv/projects/web",
    confirm: () => Promise.resolve(true),
    refuse: (reason) => {
      say(reason);
      return new Error(reason);
    },
  }).catch((error: unknown): TeleportOutcome | { kind: "threw"; why: string } => ({
    kind: "threw",
    why: String(error),
  }));

describe("the Teleport prints (#3987)", () => {
  test("the table prints the first step, the preview, the done state, both notes and a failed move", () => {
    expect(teleportShots(IDS).map((shot) => shot.name)).toEqual([
      "teleporte-passo-1",
      "teleporte-previa",
      "teleporte-feito",
      "teleporte-ws-aberto",
      "teleporte-sem-destino",
      "teleporte-falhou",
    ]);
  });

  test("each print opens the hub with the preview switch on, and only the moves that go on have the hosts answered for", () => {
    const shots = teleportShots(IDS);
    expect(shots.every((shot) => shot.route.name === "hub" && shot.teleportPreview === true)).toBe(
      true,
    );
    expect(Object.fromEntries(shots.map((shot) => [shot.name, shot.teleport ?? null]))).toEqual({
      "teleporte-passo-1": null,
      "teleporte-previa": "answers",
      "teleporte-feito": "answers",
      "teleporte-ws-aberto": null,
      "teleporte-sem-destino": null,
      "teleporte-falhou": "refuses",
    });
  });

  test("the no-target print keeps only alfa, and the plain ws print reaches beta over a name that is not this machine's", () => {
    const query = (name: string) => teleportShots(IDS).find((shot) => shot.name === name)?.query;
    expect([query("teleporte-sem-destino"), query("teleporte-ws-aberto")]).toEqual([
      { hosts: "demo-alfa" },
      { plain: "demo-beta" },
    ]);
  });
});

describe("the Teleport prints' fake hosts (#3987)", () => {
  test("the package is a manifest the app accepts, with a branch ahead of origin, changed files and lines that look like secrets", () => {
    const ack = answerTo(teleportRewriter(), "teleport.prepare", { sessionId: "s" });
    const manifest = TeleportManifestSchema.safeParse(ack?.data);
    const summary = manifest.success ? teleportSummary(manifest.data) : null;
    expect({
      acked: [ack?.type, ack?.id, ack?.ok],
      valid: manifest.success,
      ahead: (summary?.ahead ?? 0) > 0,
      changed: (summary?.changed ?? 0) > 0,
      secrets: (summary?.secretLines ?? 0) > 0,
      branch: typeof summary?.branch === "string" && summary.branch.length > 0,
    }).toEqual({
      acked: ["ack", "q1", true],
      valid: true,
      ahead: true,
      changed: true,
      secrets: true,
      branch: true,
    });
  });

  test("the app's whole move runs over the answers alone and lands on a session of the target", async () => {
    const said: string[] = [];
    const outcome = await move(teleportRewriter(), (text) => said.push(text));
    expect({ outcome, said }).toEqual({
      outcome: {
        kind: "moved",
        sessionId: expect.any(String),
        worktree: expect.any(String),
        branch: expect.any(String),
      },
      said: [],
    });
  });

  test("the clean-up never reaches the real host: the cancel, the abort and the archive of the source's copy are answered too", () => {
    const rewriter = teleportRewriter();
    const types = ["teleport.cancel", "teleport.abort", "session.meta.set"];
    expect(types.map((type) => answerTo(rewriter, type)?.ok)).toEqual([true, true, true]);
  });

  test("a refusing source sends something that is no manifest, so the app stops with its own refusal", async () => {
    const said: string[] = [];
    const outcome = await move(teleportRewriter(true), (text) => said.push(text));
    expect({ outcome: outcome.kind, said }).toEqual({
      outcome: "threw",
      said: ["teleport_corrupt"],
    });
  });

  test("a request the print does not answer for goes to the host as it was, and so does a frame that is no JSON", () => {
    const rewriter = teleportRewriter();
    expect([
      rewriter.answer?.(JSON.stringify({ id: "q1", type: "project.list", payload: {} })),
      rewriter.answer?.("not json"),
      rewriter.answer?.(JSON.stringify({ type: "teleport.prepare" })),
    ]).toEqual([undefined, undefined, undefined]);
  });

  test("the rewriter's source stands alone, as an init script carries it", () => {
    const source = teleportScript(false);
    const page = { WebSocket: class {} as unknown as typeof WebSocket };
    new Function("window", source)(page);
    expect([source.length > 0, page.WebSocket.name]).toEqual([true, "Held"]);
  });
});
