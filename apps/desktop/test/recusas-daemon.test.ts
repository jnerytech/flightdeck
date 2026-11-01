import { afterEach, describe, expect, test } from "bun:test";
import { DAEMON_REASONS } from "@flightdeck/protocol";
import { en } from "../src/i18n/en.ts";
import { refusalText, translateError } from "../src/i18n/errors.ts";
import { translator } from "../src/i18n/index.ts";
import { ptBR } from "../src/i18n/pt-BR.ts";
import { AppStore } from "../src/lib/app-store.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";

const enT = translator("en");
const ptT = translator("pt-BR");

const REASONS = [
  "cwd_missing",
  "cwd_outside_roots",
  "session_not_found",
  "session_ended",
  "session_not_ended",
  "personas_off",
  "session_not_running",
  "mcp_set_not_live",
  "mcp_query_not_live",
  "external_no_channel",
  "transcript_not_indexed",
  "session_maybe_active",
  "feature_off",
];

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

describe("recusas-daemon: the daemon's refusals about folders and sessions", () => {
  test("the protocol lists every reason, and each has a text in both languages", () => {
    expect([...(DAEMON_REASONS as readonly string[])].sort()).toEqual([...REASONS].sort());
    for (const reason of REASONS) {
      expect(typeof (en.daemonRefusal as Record<string, string>)[reason]).toBe("string");
      expect(typeof (ptBR.daemonRefusal as Record<string, string>)[reason]).toBe("string");
    }
  });

  test("a reason becomes the whole sentence, with its params, in the app's language", () => {
    const why = { reason: "cwd_outside_roots", params: { cwd: "/srv/x" } };
    expect(refusalText("forbidden_cwd", "folder outside allowedRoots: /srv/x", enT, why)).toContain(
      "The folder /srv/x is outside the host's allowed folders.",
    );
    expect(refusalText("forbidden_cwd", "folder outside allowedRoots: /srv/x", ptT, why)).toContain(
      "A pasta /srv/x está fora das pastas permitidas do host.",
    );
    expect(translateError("forbidden_cwd", "raw", enT, why).detail).toBe("");
  });

  test("a notice for a refusal keeps its reason and params, so the toast says it in the language", async () => {
    const d = makeDaemon(cleanups, {});
    const server = d.listen(0, 20);
    const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 10 });
    cleanups.push(() => store.dispose());
    const hostId = await store.addHost({ name: "pc", url: server.url, token: TOKEN });
    const deadline = Date.now() + 3000;
    while (store.getState().hosts[0]?.status !== "online" && Date.now() < deadline) {
      await Bun.sleep(10);
    }
    await store.createSession(hostId, { cwd: "/folder/nobody/made", prompt: "hi" });
    expect(store.getState().notices[0]).toMatchObject({
      code: "forbidden_cwd",
      reason: "cwd_missing",
      params: { cwd: "/folder/nobody/made" },
    });
  });
});
