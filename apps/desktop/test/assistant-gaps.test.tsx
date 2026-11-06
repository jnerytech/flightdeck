import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { ModelOption } from "@flightdeck/protocol";
import { failureOf } from "../src/components/assistant/refusal-text.ts";
import { type WandState, wandReduce } from "../src/components/assistant/wand-state.ts";
import { translator } from "../src/i18n/index.ts";
import { createWebPlatform } from "../src/platform/web/index.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { fakeAssistant, memoryPlatform, seedHosts } from "./fixtures.ts";

registerDom();
const { cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { ModelPicker } = await import("../src/components/assistant/model-picker.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

describe("assistant-gaps: small paths of the assistant's app side that no screen test reaches", () => {
  test("a rejection that is not a refusal object is the provider not answering", () => {
    expect(failureOf("invalid args")).toEqual({ reason: "assistant_offline" });
    expect(failureOf(null)).toEqual({ reason: "assistant_offline" });
    expect(failureOf({ reason: "assistant_credits", params: { a: 1 } })).toEqual({
      reason: "assistant_credits",
      params: { a: 1 },
    });
  });

  test("a wand that is running ignores a second start", () => {
    const running: WandState = { kind: "running", requestId: "r1", sent: "text", changed: false };
    expect(wandReduce(running, { type: "start", requestId: "r2", text: "other" })).toBe(running);
  });

  test("the web build has no key to delete and nothing to cancel", async () => {
    const web = createWebPlatform({} as never).assistant;
    expect(await web.deleteKey("anthropic")).toBeUndefined();
    expect(await web.cancel("r1")).toBeUndefined();
  });

  test("the store hands the assistant the hosts, the vault's names, the language and the host command", async () => {
    const mem = memoryPlatform(false, "en");
    const fake = fakeAssistant({
      run: (request) => ({
        text: "Fixed",
        model: request.model,
        provider: "anthropic",
        usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
        stopReason: "end_turn",
        notices: [],
      }),
    });
    mem.platform.assistant = fake.assistant;
    const store = new AppStore(mem.platform, { baseDelayMs: 600_000 });
    store.i18n.start();
    seedHosts(store, [{ id: "h1", name: "alfa", features: ["assistant"] }]);
    // An API provider: the vault names and the language are read when the request is built.
    await fake.assistant.setKey("anthropic", "sk-ant-aaaabbbb");
    store.assistant.setPrefs({ provider: "anthropic" });
    await store.assistant.refreshKeys();
    const result = await store.assistant.run({
      requestId: "r1",
      kind: "card.title",
      text: "fix the totl",
    });
    expect(result.text).toBe("Fixed");
    expect(fake.calls.some((c) => c[0] === "run")).toBe(true);
    // The host provider: the answer of the host's own command comes back through the store.
    const asked: string[] = [];
    store.hostRequest = (async (hostId: string, type: string) => {
      asked.push(`${hostId}:${type}`);
      return {
        ok: true,
        data: {
          text: "From the host",
          model: "claude-haiku-5-5",
          provider: "host",
          usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
          stopReason: "end_turn",
          notices: [],
        },
      };
    }) as never;
    store.assistant.setPrefs({ provider: "host", hostId: "h1", confirmedHosts: ["h1"] });
    const fromHost = await store.assistant.run({
      requestId: "r2",
      kind: "card.title",
      text: "fix the totl",
      fieldHostId: "h1",
    });
    expect(fromHost.text).toBe("From the host");
    expect(asked).toEqual(["h1:assistant.run"]);
  });
});

describe("assistant-gaps: the model picker from the keyboard", () => {
  const OPTIONS: ModelOption[] = [
    { id: "a", label: "Alpha", group: "G" },
    { id: "b", label: "Beta", group: "G" },
  ];
  function picker() {
    const changes: Array<string | null> = [];
    render(
      <ModelPicker
        t={translator("en")}
        label="Model"
        defaultLabel="Default"
        options={OPTIONS}
        value={null}
        onChange={(id) => void changes.push(id)}
      />,
    );
    return { changes, box: screen.getByRole("combobox", { name: "Model" }) as HTMLInputElement };
  }

  test("End goes to the last row, Enter chooses it, Escape clears the filter", () => {
    const { changes, box } = picker();
    fireEvent.change(box, { target: { value: "alp" } });
    expect(screen.queryByRole("option", { name: /Beta/ })).toBeNull();
    fireEvent.keyDown(box, { key: "Escape" });
    expect(box.value).toBe("");
    fireEvent.keyDown(box, { key: "End" });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(changes).toEqual(["b"]);
  });

  test("a row takes Enter and Space itself", () => {
    const { changes } = picker();
    const row = screen.getAllByRole("option", { name: /Alpha/ })[0] as HTMLElement;
    fireEvent.keyDown(row, { key: "Enter" });
    fireEvent.keyDown(row, { key: " " });
    fireEvent.keyDown(row, { key: "x" });
    expect(changes).toEqual(["a", "a"]);
  });
});
