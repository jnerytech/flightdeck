import { afterEach, describe, expect, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { cleanup, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { UsageLog } = await import("../../src/features/vault/usage-log.tsx");
const { TContext } = await import("../../src/i18n/context.tsx");
const { translator } = await import("../../src/i18n/index.ts");

const stores: Array<{ dispose(): unknown }> = [];
afterEach(() => {
  cleanup();
  for (const store of stores.splice(0)) store.dispose();
});

/** The usage log with one line, at 15:04 in São Paulo (18:04 UTC), in the app's language. */
function usageLine(language: "pt-BR" | "en") {
  const store = new AppStore(memoryPlatform(false, language).platform, {
    timeZone: "America/Sao_Paulo",
  });
  store.i18n.start();
  stores.push(store);
  store.usage.recordUsed("h1", {
    type: "vault.used",
    secretId: "s1",
    purpose: "ssh",
    requester: "claude",
    action: "ssh deploy@box",
    at: "2026-10-30T18:04:05.000Z",
  });
  render(
    <TContext.Provider value={translator(language)}>
      <UsageLog store={store} />
    </TContext.Provider>,
  );
  const list = screen.queryByRole("list", {
    name: language === "en" ? "Usage log" : "Registro de uso",
  });
  expect(list).not.toBeNull();
  return list?.textContent ?? "";
}

describe("vault usage log time (#3692)", () => {
  test("a usage line's date and time are written in the app's language and zone, pt-BR (24-hour)", () => {
    expect(usageLine("pt-BR")).toContain("15:04");
  });

  test("a usage line's date and time of an app in English are 12-hour with AM/PM", () => {
    expect(usageLine("en")).toMatch(/3:04\s?PM/);
  });
});
