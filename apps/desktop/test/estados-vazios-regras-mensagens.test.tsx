import { afterEach, describe, expect, test } from "bun:test";
import type { MessageInfo } from "@flightdeck/protocol";
import { registerDom } from "./dom.ts";

registerDom();
const { act, cleanup, render } = await import("@testing-library/react");
const { TContext } = await import("../src/i18n/context.tsx");
const { translator } = await import("../src/i18n/index.ts");
const { RulesSection } = await import("../src/ui/RulesSection.tsx");
const { SessionMessages } = await import("../src/ui/SessionMessages.tsx");

import type { AppStore } from "../src/lib/app-store.ts";

afterEach(cleanup);

const EMPTY_RULES = {
  en: 'No rules yet. Choose "Always in this project" when Claude asks for permission and the rule shows up here.',
  "pt-BR":
    'Nenhuma regra ainda. Escolha "Sempre neste projeto" quando o Claude pedir permissão e a regra aparece aqui.',
};
const EMPTY_MESSAGES = {
  en: "No messages yet. Use “Send to another session…” to write the first one.",
  "pt-BR": "Nenhuma mensagem ainda. Use “Mandar para outra sessão…” para escrever a primeira.",
};

/** A store that answers `hostCommand` from `answers`, by command name. */
function fakeStore(language: "en" | "pt-BR", answers: Record<string, unknown>) {
  return {
    hostCommand: async (_host: string, command: string) => answers[command] ?? null,
    onMessageUpdated: () => () => {},
    formatDateTime: (iso: string) => iso,
    i18n: { t: translator(language) },
  } as unknown as AppStore;
}

const message: MessageInfo = {
  id: "m1",
  fromSession: "s9",
  fromHost: "h",
  toSession: "c1",
  toHost: "h",
  text: "a revisão está pronta",
  status: "delivered",
  reason: null,
  createdAt: "2026-10-30T12:00:00.000Z",
  deliveredAt: "2026-10-30T12:00:01.000Z",
  teamId: null,
  kind: "session",
};

describe("estados-vazios: rules and session messages", () => {
  for (const language of ["en", "pt-BR"] as const) {
    test(`a project with no rules says how a rule appears, in ${language}`, async () => {
      const store = fakeStore(language, { "rules.list": { rules: [] } });
      const view = render(
        <TContext.Provider value={translator(language)}>
          <RulesSection store={store} hostId="h" projectId="p" />
        </TContext.Provider>,
      );
      await act(() => Bun.sleep(10));
      expect(view.container.textContent).toContain(EMPTY_RULES[language]);
      expect(view.container.querySelector("ul")).toBeNull();
    });

    test(`a session with no messages says how to send one, in ${language}`, async () => {
      const store = fakeStore(language, { "messages.list": { messages: [] } });
      const view = render(<SessionMessages store={store} hostId="h" sessionId="c1" />);
      await act(() => Bun.sleep(10));
      expect(view.container.textContent).toContain(EMPTY_MESSAGES[language]);
      expect(view.container.querySelector("ul")).toBeNull();
    });
  }

  test("a project with a rule and a session with a message show the lists, not the empty states", async () => {
    const rules = render(
      <RulesSection
        store={fakeStore("en", { "rules.list": { rules: ["Bash(git status:*)"] } })}
        hostId="h"
        projectId="p"
      />,
    );
    await act(() => Bun.sleep(10));
    expect(rules.container.textContent).toContain("Bash(git status:*)");
    expect(rules.container.textContent).not.toContain(EMPTY_RULES.en);
    cleanup();
    const messages = render(
      <SessionMessages
        store={fakeStore("en", { "messages.list": { messages: [message] } })}
        hostId="h"
        sessionId="c1"
      />,
    );
    await act(() => Bun.sleep(10));
    expect(messages.container.textContent).toContain("a revisão está pronta");
    expect(messages.container.textContent).not.toContain(EMPTY_MESSAGES.en);
  });
});
