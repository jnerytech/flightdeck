import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon, memoryPlatform, TOKEN } from "./fixtures.ts";
import { settle, uiIdle } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");
const { applyEnvelope, emptySession } = await import("../src/lib/session-state.ts");
const { errorText, SessionView } = await import("../src/ui/SessionView.tsx");
const { translator } = await import("../src/i18n/index.ts");

setDefaultTimeout(30_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const options = (label: string) =>
  [
    ...(((screen.queryByLabelText(label) as HTMLSelectElement | null)?.options ??
      []) as HTMLOptionsCollection),
  ].map((o) => o.value);

/** The app on a host with (or without) OpenCode, on its new-session screen. */
async function open(lang: "en" | "pt-BR", opencode: boolean) {
  const d = await daemon(cleanups, { opencode });
  const store = new AppStore(memoryPlatform(false, lang).platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  const hostId = await store.addHost({ name: "pi", url: d.listen().url, token: TOKEN });
  render(<App store={store} />);
  await settle(() => Boolean(store.getState().hosts[0]?.hostInfo));
  await act(async () => {
    store.router.push({ name: "new-session", host: hostId });
  });
  await settle(
    () => screen.queryByLabelText(lang === "en" ? "First prompt" : "Primeiro prompt") !== null,
  );
  return { d, store, hostId };
}

describe("opencode-session-ui", () => {
  test("a host with OpenCode offers the agent; OpenCode brings its models, its effort and three modes, and no persona", async () => {
    await open("en", true);
    expect(options("Agent")).toEqual(["claude", "opencode"]);
    await act(async () => {
      fireEvent.change(screen.queryByLabelText("Agent") as HTMLElement, {
        target: { value: "opencode" },
      });
    });
    await settle(() => options("Model").includes("anthropic/claude-sonnet-5-5"));
    expect(options("Model")).toEqual([
      "",
      "anthropic/claude-sonnet-5-5",
      "opencode/crouton-alpha-free",
    ]);
    expect(options("Permission mode")).toEqual(["default", "plan"]);
    expect(options("Effort")).toEqual(["", "low", "medium", "high", "xhigh", "max"]);
    expect(screen.queryByLabelText("Persona")).toBeNull();
  });

  test("an OpenCode session is created as OpenCode's and its page says so, without the model switch", async () => {
    const { d } = await open("en", true);
    expect(screen.queryByLabelText("Agent")).not.toBeNull();
    await act(async () => {
      fireEvent.change(screen.queryByLabelText("Agent") as HTMLElement, {
        target: { value: "opencode" },
      });
    });
    await act(async () => {
      fireEvent.change(screen.queryByLabelText("Effort") as HTMLElement, {
        target: { value: "high" },
      });
    });
    await act(async () => {
      fireEvent.change(screen.queryByLabelText("First prompt") as HTMLElement, {
        target: { value: "hello" },
      });
    });
    await uiIdle();
    await act(async () => {
      fireEvent.click(screen.queryByRole("button", { name: "Create session" }) as HTMLElement);
    });
    await settle(() => d.manager.list().length === 1);
    expect(d.manager.list()[0]?.runtime).toBe("opencode");
    await settle(() => (d.opencodeRuntime?.starts.length ?? 0) > 0);
    expect(d.opencodeRuntime?.starts[0]?.effort).toBe("high");
    await settle(() => screen.queryByText("OpenCode") !== null);
    expect(screen.queryByLabelText("Model")).toBeNull();
  });

  test("a host without OpenCode does not offer the agent; the label is translated", async () => {
    await open("en", false);
    expect(screen.queryByLabelText("Agent")).toBeNull();
    cleanup();
    await open("pt-BR", true);
    expect(options("Agente")).toEqual(["claude", "opencode"]);
  });

  test("an OpenCode session leaves out Claude Code's panels: terminal, timeline, persona, recap", () => {
    const actions = {
      send: async () => {},
      interrupt: async () => {},
      close: async () => {},
      resume: async () => {},
      respond: async () => {},
    };
    const panel = (name: string) => <button type="button">{name}</button>;
    const view = (runtime: "claude" | "opencode") => (
      <SessionView
        title="s"
        session={{ ...emptySession(), status: "idle", claudeSessionId: "ses_1" }}
        actions={actions}
        runtime={runtime}
        terminal={panel("terminal")}
        timeline={panel("timeline")}
        persona={panel("persona")}
        recap={panel("recap")}
      />
    );
    const shown = () =>
      ["terminal", "timeline", "persona", "recap"].filter(
        (name) => screen.queryByRole("button", { name }) !== null,
      );
    const utils = render(view("claude"));
    expect(shown()).toEqual(["terminal", "timeline", "persona", "recap"]);
    utils.rerender(view("opencode"));
    expect(shown()).toEqual([]);
  });

  test("a session error with a reason reads as the app's sentence, in its language", () => {
    const state = applyEnvelope(emptySession(), {
      type: "event",
      sessionId: "s1",
      ts: "2026-11-05T00:00:00.000Z",
      seq: 3,
      event: {
        type: "session.error",
        code: "opencode_permissions_overridden",
        message: "OpenCode's mode is not Flightdeck's (mode build)",
        reason: "opencode_permissions_overridden",
        params: { detail: "mode build" },
      },
    } as never);
    const item = state.items.at(-1);
    expect(item && item.kind === "error" ? errorText(item, translator("en")) : null).toBe(
      "Something outside Flightdeck changed OpenCode's rules during the session (mode build), so the session was stopped.",
    );
    expect(item && item.kind === "error" ? errorText(item, translator("pt-BR")) : null).toBe(
      "Algo fora do Flightdeck mudou as regras do OpenCode durante a sessão (mode build), então a sessão foi parada.",
    );
    expect(
      errorText({ kind: "error", seq: 1, code: "runtime", message: "boom" }, translator("en")),
    ).toBe("runtime: boom");
  });
});
