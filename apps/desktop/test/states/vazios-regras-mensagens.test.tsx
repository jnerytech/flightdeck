import { afterEach, describe, expect, test } from "bun:test";
import type { MessageInfo, MessagingSession } from "@flightdeck/protocol";
import { registerDom } from "../dom.ts";
import { uiIdle } from "../wait.ts";

registerDom();
const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
const { TContext } = await import("../../src/i18n/context.tsx");
const { translator } = await import("../../src/i18n/index.ts");
const { RulesSection } = await import("../../src/features/permissions/project-rules.tsx");
const { SessionMessages } = await import("../../src/features/messaging/session-messages.tsx");

import type { AppStore } from "../../src/lib/app-store.ts";

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

/** The same state object on every read: a new one would make the slice read as changed. */
const APP_STATE = { loopAlerts: [] };

/** A store that answers `hostCommand` from `answers`, by command name. */
function fakeStore(language: "en" | "pt-BR", answers: Record<string, unknown>) {
  return {
    hostCommand: async (_host: string, command: string) => answers[command] ?? null,
    hostRequest: async (_host: string, command: string) =>
      answers[command] ? { ok: true, data: answers[command] } : { ok: false, message: "no answer" },
    messaging: { onUpdated: () => () => {} },
    // The rules link reads the loop alerts the app store keeps.
    subscribe: () => () => {},
    getState: () => APP_STATE,
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
      await uiIdle();
      expect(view.container.textContent).toContain(EMPTY_RULES[language]);
      expect(view.container.querySelector("ul")).toBeNull();
    });

    test(`a session with no messages says how to send one, in ${language}`, async () => {
      const store = fakeStore(language, { "messages.list": { messages: [] } });
      const view = render(<SessionMessages store={store} hostId="h" sessionId="c1" />);
      await uiIdle();
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
    await uiIdle();
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
    await uiIdle();
    expect(messages.container.textContent).toContain("a revisão está pronta");
    expect(messages.container.textContent).not.toContain(EMPTY_MESSAGES.en);
  });
});

const peer = (name: string | null, id = "s9"): MessagingSession =>
  ({ address: `h/${id}`, id, host: "h", name }) as MessagingSession;

/** A store whose `messages.send` answers with `status` and counts the sends. */
function writingStore(
  language: "en" | "pt-BR",
  options: { sessions: MessagingSession[]; messages?: MessageInfo[]; status?: string },
) {
  const sends: unknown[] = [];
  const store = {
    hostCommand: async (_host: string, command: string, payload: unknown) => {
      if (command === "messages.list") return { messages: options.messages ?? [] };
      if (command === "messages.sessions") return { sessions: options.sessions };
      if (command === "messages.send") {
        sends.push(payload);
        return { id: "m2", status: options.status ?? "delivered", reason: null };
      }
      return null;
    },
    messaging: { onUpdated: () => () => {} },
    // The rules link reads the loop alerts the app store keeps.
    subscribe: () => () => {},
    getState: () => APP_STATE,
    formatDateTime: (iso: string) => iso,
    i18n: { t: translator(language) },
  } as unknown as AppStore;
  return { store, sends };
}

const WRITE = { en: "Send to another session…", "pt-BR": "Mandar para outra sessão…" };
const SEND = { en: "Send", "pt-BR": "Enviar" };
const CANCEL = { en: "Cancel", "pt-BR": "Cancelar" };
const NO_TARGET = {
  en: "No other session can receive a message from this one.",
  "pt-BR": "Nenhuma outra sessão pode receber uma mensagem desta.",
};

const button = (root: HTMLElement, label: string) =>
  [...root.querySelectorAll("button")].find((b) => b.textContent?.trim() === label) ?? null;

async function open(root: HTMLElement, language: "en" | "pt-BR") {
  await act(async () => {
    fireEvent.click(button(root, WRITE[language]) as HTMLElement);
  });
  await uiIdle();
}

describe("session messages: the write form (#3852)", () => {
  for (const language of ["en", "pt-BR"] as const) {
    test(`a delivered message empties the box and Send waits for a new text, in ${language}`, async () => {
      const { store, sends } = writingStore(language, { sessions: [peer("Reviewer")] });
      const view = render(<SessionMessages store={store} hostId="h" sessionId="c1" />);
      await uiIdle();
      await open(view.container, language);
      const box = view.container.querySelector("textarea") as HTMLTextAreaElement;
      fireEvent.change(box, { target: { value: "ship it" } });
      await act(async () => {
        fireEvent.click(button(view.container, SEND[language]) as HTMLElement);
      });
      await uiIdle();
      expect(sends).toHaveLength(1);
      expect(box.value).toBe("");
      expect(document.activeElement === box).toBe(true); // NOSONAR: a boolean keeps a DOM node out of the failure diff
      expect((button(view.container, SEND[language]) as HTMLButtonElement).disabled).toBe(true);
      expect(view.container.querySelector("output")).not.toBeNull();
    });

    test(`a refused message keeps its text so it can be fixed, in ${language}`, async () => {
      const { store } = writingStore(language, { sessions: [peer("Reviewer")], status: "refused" });
      const view = render(<SessionMessages store={store} hostId="h" sessionId="c1" />);
      await uiIdle();
      await open(view.container, language);
      const box = view.container.querySelector("textarea") as HTMLTextAreaElement;
      fireEvent.change(box, { target: { value: "ship it" } });
      await act(async () => {
        fireEvent.click(button(view.container, SEND[language]) as HTMLElement);
      });
      await uiIdle();
      expect(box.value).toBe("ship it");
    });

    test(`opening the form focuses To and Cancel returns to the write button, in ${language}`, async () => {
      const { store } = writingStore(language, { sessions: [peer("Reviewer")] });
      const view = render(<SessionMessages store={store} hostId="h" sessionId="c1" />);
      await uiIdle();
      await open(view.container, language);
      expect(document.activeElement === view.container.querySelector("select")).toBe(true); // NOSONAR: a boolean keeps a DOM node out of the failure diff
      await act(async () => {
        fireEvent.click(button(view.container, CANCEL[language]) as HTMLElement);
      });
      await uiIdle();
      expect(document.activeElement === button(view.container, WRITE[language])).toBe(true); // NOSONAR: a boolean keeps a DOM node out of the failure diff
    });

    test(`a result of an earlier send does not show again on reopening, in ${language}`, async () => {
      const { store } = writingStore(language, { sessions: [peer("Reviewer")] });
      const view = render(<SessionMessages store={store} hostId="h" sessionId="c1" />);
      await uiIdle();
      await open(view.container, language);
      fireEvent.change(view.container.querySelector("textarea") as HTMLElement, {
        target: { value: "ship it" },
      });
      await act(async () => {
        fireEvent.click(button(view.container, SEND[language]) as HTMLElement);
      });
      await uiIdle();
      await act(async () => {
        fireEvent.click(button(view.container, CANCEL[language]) as HTMLElement);
      });
      await open(view.container, language);
      expect(view.container.querySelector("output") === null).toBe(true); // NOSONAR: a boolean keeps a DOM node out of the failure diff
    });

    test(`with no session to message, one line says so, in ${language}`, async () => {
      const { store } = writingStore(language, { sessions: [] });
      const view = render(<SessionMessages store={store} hostId="h" sessionId="c1" />);
      await uiIdle();
      await open(view.container, language);
      expect(view.container.textContent?.includes(NO_TARGET[language])).toBe(true);
    });
  }

  test("a row names the other side when the sessions list knows it, and the id when not", async () => {
    const known = { ...message, id: "m1" };
    const unknown = {
      ...message,
      id: "m2",
      fromSession: "s7",
      createdAt: "2026-10-30T11:00:00.000Z",
    };
    const sent = {
      ...message,
      id: "m3",
      fromSession: "c1",
      toSession: "s9",
      createdAt: "2026-10-30T10:00:00.000Z",
    };
    const { store } = writingStore("en", {
      sessions: [peer("Reviewer")],
      messages: [known, unknown, sent],
    });
    const view = render(<SessionMessages store={store} hostId="h" sessionId="c1" />);
    await uiIdle();
    const rows = [...view.container.querySelectorAll("li")].map((li) => li.textContent ?? "");
    expect(rows[0]?.includes("From Reviewer")).toBe(true);
    expect(rows[0]?.includes("h/s9 →")).toBe(false);
    expect(rows[1]?.includes("From h/s7")).toBe(true);
    expect(rows[2]?.includes("To Reviewer")).toBe(true);
  });

  test("a row names the other side in Portuguese", async () => {
    const { store } = writingStore("pt-BR", {
      sessions: [peer("Revisora")],
      messages: [message],
    });
    const view = render(<SessionMessages store={store} hostId="h" sessionId="c1" />);
    await uiIdle();
    expect(view.container.querySelector("li")?.textContent?.includes("De Revisora")).toBe(true);
  });
});

const LOADING = { en: "Loading messages", "pt-BR": "Carregando mensagens" };
const LOAD_FAILED = {
  en: "Could not load this session's messages.",
  "pt-BR": "Não foi possível carregar as mensagens desta sessão.",
};
const RETRY = { en: "Try again", "pt-BR": "Tentar de novo" };
const SEND_NEEDS = {
  en: "Choose a session and write a text.",
  "pt-BR": "Escolha uma sessão e escreva um texto.",
};

/** A store whose `messages.list` answers when `answer` is called: `null` is a refusal. */
function slowStore(language: "en" | "pt-BR") {
  const waiting: Array<(list: MessageInfo[] | null) => void> = [];
  const store = {
    hostCommand: (_host: string, command: string) => {
      if (command === "messages.sessions") return Promise.resolve({ sessions: [peer("Reviewer")] });
      if (command !== "messages.list") return Promise.resolve(null);
      return new Promise((resolve) =>
        waiting.push((list) => resolve(list ? { messages: list } : null)),
      );
    },
    messaging: { onUpdated: () => () => {} },
    subscribe: () => () => {},
    getState: () => APP_STATE,
    formatDateTime: (iso: string) => iso,
    i18n: { t: translator(language) },
  } as unknown as AppStore;
  const answer = (list: MessageInfo[] | null) => act(async () => waiting.shift()?.(list));
  return { store, answer };
}

describe("session messages: loading, a failed list and the Send reason (#4296)", () => {
  for (const language of ["en", "pt-BR"] as const) {
    test(`the list says it is loading until the host answers, then says it is empty, in ${language}`, async () => {
      const { store, answer } = slowStore(language);
      const view = render(<SessionMessages store={store} hostId="h" sessionId="c1" />);
      await uiIdle();
      const loading = () => view.container.querySelector(`[aria-label="${LOADING[language]}"]`);
      expect(loading()).not.toBeNull();
      expect(view.container.textContent).not.toContain(EMPTY_MESSAGES[language]);
      await answer([]);
      await uiIdle();
      expect(loading()).toBeNull();
      expect(view.container.textContent).toContain(EMPTY_MESSAGES[language]);
    });

    test(`a refused list says so and Try again loads it, in ${language}`, async () => {
      const { store, answer } = slowStore(language);
      const view = render(<SessionMessages store={store} hostId="h" sessionId="c1" />);
      await uiIdle();
      await answer(null);
      await uiIdle();
      expect(view.container.textContent).toContain(LOAD_FAILED[language]);
      expect(view.container.textContent).not.toContain(EMPTY_MESSAGES[language]);
      await act(async () => {
        fireEvent.click(button(view.container, RETRY[language]) as HTMLElement);
      });
      await answer([message]);
      await uiIdle();
      expect(view.container.textContent).not.toContain(LOAD_FAILED[language]);
      expect(view.container.textContent).toContain("a revisão está pronta");
    });

    test(`a disabled Send says why until there is a session and a text, in ${language}`, async () => {
      const { store, sends } = writingStore(language, { sessions: [peer("Reviewer")] });
      const view = render(<SessionMessages store={store} hostId="h" sessionId="c1" />);
      await uiIdle();
      await open(view.container, language);
      expect(view.container.textContent).toContain(SEND_NEEDS[language]);
      fireEvent.change(view.container.querySelector("textarea") as HTMLTextAreaElement, {
        target: { value: "ship it" },
      });
      await uiIdle();
      expect(view.container.textContent).not.toContain(SEND_NEEDS[language]);
      expect(sends).toHaveLength(0);
    });
  }
});
