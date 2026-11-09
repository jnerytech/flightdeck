import { describe, expect, test } from "bun:test";
import { tauriPlatform } from "../src/platform/tauri/index.ts";

/**
 * Issue #1462: the desktop shell's loopback listener, reached through three Rust commands. The
 * listener verifies the state itself; the platform gives the caller the code with the state it asked
 * for, and null when the person refused, it timed out or it was cancelled.
 */
function platformWith(answers: { wait: string | null }) {
  const invokes: Array<[string, unknown]> = [];
  const call = (async (cmd: string, args?: unknown) => {
    invokes.push([cmd, args]);
    if (cmd === "oauth_loopback_listen") return { id: 7, port: 5555 };
    if (cmd === "oauth_loopback_wait") return answers.wait;
    return undefined;
  }) as never;
  return { platform: tauriPlatform({} as never, call), invokes };
}

describe("tauri platform: oauthLoopback (#1462)", () => {
  test("listen hands the state to the shell and gives back the port", async () => {
    const { platform, invokes } = platformWith({ wait: "the-code" });
    const listener = await platform.oauthLoopback?.listen("state-1");
    expect(listener?.port).toBe(5555);
    expect(invokes).toEqual([["oauth_loopback_listen", { state: "state-1" }]]);
  });

  test("wait gives the code with the state it listened for, and asks for the same session", async () => {
    const { platform, invokes } = platformWith({ wait: "the-code" });
    const listener = await platform.oauthLoopback?.listen("state-1");
    expect(await listener?.wait()).toEqual({ code: "the-code", state: "state-1" });
    expect(invokes.at(-1)).toEqual(["oauth_loopback_wait", { id: 7 }]);
  });

  test("a refusal, a timeout or a cancel is null", async () => {
    const { platform } = platformWith({ wait: null });
    const listener = await platform.oauthLoopback?.listen("state-1");
    expect(await listener?.wait()).toBeNull();
  });

  test("cancel closes the session and does not wait for the answer", async () => {
    const { platform, invokes } = platformWith({ wait: null });
    const listener = await platform.oauthLoopback?.listen("state-1");
    listener?.cancel();
    expect(invokes.at(-1)).toEqual(["oauth_loopback_cancel", { id: 7 }]);
  });
});
