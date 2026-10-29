import { describe, expect, test } from "bun:test";
import { utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type ExternalSession, ExternalSessions } from "../src/central/external.ts";
import { EventStore } from "../src/store/event-store.ts";
import { tempDir } from "./helpers.ts";

const T0 = Date.parse("2026-10-29T12:00:00.000Z");

function setup(staleAfterS = 900) {
  const store = new EventStore(":memory:");
  let now = T0;
  const dir = tempDir();
  const transcript = join(dir, "s1.jsonl");
  writeFileSync(transcript, "");
  utimesSync(transcript, new Date(T0 - 3_600_000), new Date(T0 - 3_600_000));
  const make = () =>
    new ExternalSessions({
      db: store.db,
      staleAfterS,
      now: () => now,
      projectKey: (cwd) => `chave:${cwd}`,
    });
  const registry = make();
  const updates: ExternalSession[] = [];
  registry.onChange((session) => updates.push(session));
  const start = (id = "s1", launch?: string) =>
    registry.apply("SessionStart", {
      session_id: id,
      cwd: dir,
      transcript_path: transcript,
      source: "startup",
      ...(launch ? { launch_id: launch } : {}),
    });
  return {
    registry,
    make,
    dir,
    transcript,
    updates,
    start,
    tick: (ms: number) => {
      now += ms;
    },
  };
}

describe("sessoes-externas", () => {
  test("SessionStart registra a sessão ociosa com cwd, transcript, origem, launch id e projeto", () => {
    const { registry, start, dir, transcript } = setup();
    const session = start("s1", "L1");
    expect(session).toMatchObject({
      claudeSessionId: "s1",
      cwd: dir,
      transcriptPath: transcript,
      source: "startup",
      status: "idle",
      launchId: "L1",
      controllable: false,
      projectKey: `chave:${dir}`,
      startedAt: new Date(T0).toISOString(),
      endedAt: null,
    });
    expect(registry.list().map((s) => s.claudeSessionId)).toEqual(["s1"]);
  });

  test("cada evento da tabela leva ao estado certo", () => {
    const { registry, start } = setup();
    start();
    const steps: Array<[string, Record<string, unknown>, string]> = [
      ["UserPromptSubmit", {}, "running"],
      ["PermissionRequest", { tool_name: "Write" }, "awaiting_permission"],
      ["PostToolUse", {}, "running"],
      ["Notification", { notification_type: "permission_prompt" }, "awaiting_permission"],
      ["PermissionDenied", {}, "running"],
      ["Notification", { notification_type: "idle_prompt" }, "running"],
      ["PostToolUseFailure", {}, "running"],
      ["Stop", {}, "idle"],
      ["SessionEnd", { reason: "exit" }, "ended"],
    ];
    for (const [event, payload, status] of steps) {
      expect(registry.apply(event, { session_id: "s1", ...payload })?.status).toBe(status);
    }
    expect(registry.get("s1")?.endedAt).not.toBeNull();
    expect(registry.get("s1")?.statusReason).toBe("exit");
  });

  test("evento de sessão desconhecida a registra; sem session_id é ignorado", () => {
    const { registry, dir } = setup();
    const session = registry.apply("UserPromptSubmit", { session_id: "s9", cwd: dir });
    expect(session).toMatchObject({ claudeSessionId: "s9", status: "running", cwd: dir });
    expect(registry.apply("Stop", {})).toBeNull();
    expect(registry.get("nao-existe")).toBeNull();
  });

  test("sem evento e sem mudança no transcript além do limite, vira ended com motivo stale", () => {
    const { registry, start, tick, transcript } = setup(900);
    start();
    tick(899_000);
    registry.sweep();
    expect(registry.get("s1")?.status).toBe("idle");
    // The transcript changed recently: still alive.
    tick(2_000);
    utimesSync(transcript, new Date(T0 + 900_500), new Date(T0 + 900_500));
    registry.sweep();
    expect(registry.get("s1")?.status).toBe("idle");
    tick(900_000);
    registry.sweep();
    expect(registry.get("s1")).toMatchObject({ status: "ended", statusReason: "stale" });
  });

  test("a varredura roda no intervalo dado, com timers injetáveis", () => {
    const { registry, start, tick } = setup(1);
    start();
    let callback: (() => void) | null = null;
    let cleared = false;
    registry.start(60_000, {
      setInterval: (fn: () => void) => {
        callback = fn;
        return 1 as unknown as ReturnType<typeof setInterval>;
      },
      clearInterval: () => {
        cleared = true;
      },
    });
    tick(5_000);
    (callback as (() => void) | null)?.();
    expect(registry.get("s1")?.status).toBe("ended");
    registry.stop();
    expect(cleared).toBe(true);
  });

  test("depois de reiniciar, as sessões não encerradas voltam como unknown até o próximo evento", () => {
    const { registry, make, start } = setup();
    start("s1");
    start("s2");
    registry.apply("SessionEnd", { session_id: "s2" });
    const again = make();
    expect(again.get("s1")?.status).toBe("unknown");
    expect(again.get("s2")?.status).toBe("ended");
    expect(again.apply("UserPromptSubmit", { session_id: "s1" })?.status).toBe("running");
  });

  test("controllable segue o canal do launch id, inclusive depois de /clear", () => {
    const { registry, make, start } = setup();
    start("s1", "L1");
    registry.setChannel("L1", true);
    expect(registry.get("s1")?.controllable).toBe(true);
    // /clear: a new session_id with the same launch id; the channel follows it.
    start("s2", "L1");
    expect(registry.get("s2")?.controllable).toBe(true);
    expect(registry.get("s1")?.controllable).toBe(false);
    expect(registry.sessionForLaunch("L1")).toBe("s2");
    registry.setChannel("L1", false);
    expect(registry.get("s2")?.controllable).toBe(false);
    registry.setChannel("L1", true);
    // A restart drops every channel connection.
    expect(make().get("s2")?.controllable).toBe(false);
    expect(registry.sessionForLaunch("nenhum")).toBeNull();
  });

  test("sessão sem transcript legível também vira stale", () => {
    const { registry, tick } = setup(1);
    registry.apply("UserPromptSubmit", { session_id: "s9" });
    tick(5_000);
    const status = (() => {
      try {
        registry.sweep();
        return registry.get("s9")?.status;
      } catch {
        return "a varredura falhou";
      }
    })();
    expect(status).toBe("ended");
  });

  test("quem para de ouvir não recebe mais nada", () => {
    const { start, registry } = setup();
    const seen: string[] = [];
    const stop = registry.onChange((session) => seen.push(session.status));
    start();
    stop();
    registry.apply("UserPromptSubmit", { session_id: "s1" });
    expect(seen).toEqual(["idle"]);
  });

  test("cada mudança é publicada", () => {
    const { start, registry, updates } = setup();
    start();
    registry.apply("UserPromptSubmit", { session_id: "s1" });
    expect(updates.map((s) => s.status)).toEqual(["idle", "running"]);
  });
});
