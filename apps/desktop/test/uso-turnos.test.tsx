import { afterEach, describe, expect, test } from "bun:test";
import { registerDom } from "./dom.ts";

registerDom();
const { act, cleanup, render } = await import("@testing-library/react");
const { TContext } = await import("../src/i18n/context.tsx");
const { translator } = await import("../src/i18n/index.ts");
const { UsagePanel } = await import("../src/ui/UsagePanel.tsx");

import type { AppStore } from "../src/lib/app-store.ts";

afterEach(cleanup);

const row = (projectKey: string, turns: number) => ({
  day: "2026-10-31",
  projectKey,
  costUsd: 1,
  inputTokens: 10,
  outputTokens: 20,
  turns,
});

describe("uso-turnos: the legacy usage table counts turns from the dictionary", () => {
  for (const [language, one, other] of [
    ["en", "1 turn", "2 turns"],
    ["pt-BR", "1 turno", "2 turnos"],
  ] as const) {
    test(`one turn and several turns, in ${language}`, async () => {
      const store = {
        today: () => "2026-11-01",
        hostCommand: async () => ({ rows: [row("kA", 1), row("kB", 2)] }),
      } as unknown as AppStore;
      const view = render(
        <TContext.Provider value={translator(language)}>
          <UsagePanel store={store} hostId="h" online costs={false} />
        </TContext.Provider>,
      );
      await act(() => Bun.sleep(10));
      const cells = [...view.container.querySelectorAll("td")].map((td) => td.textContent);
      expect(cells).toContain(one);
      expect(cells).toContain(other);
    });
  }
});
