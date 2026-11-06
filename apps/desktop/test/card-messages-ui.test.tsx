import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { AssistantResult } from "@flightdeck/protocol";
import { liveScreen, registerDom } from "./dom.ts";
import { fakeAssistant } from "./fixtures.ts";
import { settle } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { CardReview } = await import("../src/ui/CardReview.tsx");
const { PrDescriptionDialog } = await import("../src/components/watch/pr-description-dialog.tsx");
const { AssistantController } = await import("../src/lib/assistant.ts");
const { AppStore } = await import("../src/lib/app-store.ts");
const { memoryPlatform } = await import("./fixtures.ts");
const { TContext } = await import("../src/i18n/context.tsx");
const { translator } = await import("../src/i18n/index.ts");
const { TooltipProvider } = await import("../src/components/ui/tooltip.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

/**
 * Issue #162: the place in the app that asks for a commit or PR message. The merge of a card takes
 * the message the person confirmed (the wand writes it from the card's repo); the PR takes the
 * title and the description the person confirmed, each with its own wand.
 */
const MESSAGE = "feat(app): add the login";
const SOURCE = { kind: "card", cardId: "c1" };

const RESULT: AssistantResult = {
  text: MESSAGE,
  model: "claude-sonnet-5-5",
  provider: "host",
  usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0 },
  stopReason: "end_turn",
  notices: [],
};

const WORDS = {
  en: {
    merge: "Merge and archive",
    message: "Commit message",
    write: "Write with AI",
    improve: "Improve with AI",
    accept: "Accept",
    prTitle: "PR title",
    open: "Open the PR with this text",
  },
  "pt-BR": {
    merge: "Merge e arquivar",
    message: "Mensagem do commit",
    write: "Escrever com IA",
    improve: "Melhorar com IA",
    accept: "Aceitar",
    prTitle: "Título do PR",
    open: "Abrir o PR com este texto",
  },
} as const;

function setup(lang: "en" | "pt-BR") {
  const sent: Array<[string, string, unknown]> = [];
  const items = new Map<string, string>();
  const controller = new AssistantController({
    storage: { getItem: (k) => items.get(k) ?? null, setItem: (k, v) => void items.set(k, v) },
    api: fakeAssistant({ supported: false }).assistant,
    hosts: () => [{ id: "h1", online: true, assistant: true }],
    secrets: () => [],
    language: () => lang,
    request: async (hostId, type, payload) => {
      sent.push([hostId, type, payload]);
      return { ok: true, data: RESULT } as never;
    },
  });
  controller.setPrefs({ enabled: true, provider: "host", confirmedHosts: ["h1"] });
  const store = {
    assistant: controller,
    hostRequest: async (hostId: string, type: string, payload: unknown) => {
      sent.push([hostId, type, payload]);
      return { ok: true, data: {} };
    },
    success: () => {},
    router: { push: () => {} },
  } as unknown as InstanceType<typeof AppStore>;
  return { store, sent, t: translator(lang) };
}

const press = async (button: HTMLElement | null) => {
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
};

function renderReview(lang: "en" | "pt-BR") {
  const ctx = setup(lang);
  render(
    <TContext.Provider value={ctx.t}>
      <TooltipProvider>
        <CardReview
          store={ctx.store}
          hostId="h1"
          card={{ id: "c1", prUrl: null, title: "Add the login" } as never}
          changes={{ base: "main", position: { ahead: 1, behind: 0 } } as never}
          refresh={async () => {}}
        />
      </TooltipProvider>
    </TContext.Provider>,
  );
  return ctx;
}

const mergeCall = (sent: Array<[string, string, unknown]>) =>
  sent.find(([, type]) => type === "card.mergeLocal")?.[2] as Record<string, unknown> | undefined;

describe("card-messages-ui: the merge of a card asks for its commit message (#162)", () => {
  for (const lang of ["en", "pt-BR"] as const) {
    const w = WORDS[lang];

    test(`the wand writes the message from the card's repo and the merge sends it (${lang})`, async () => {
      const { sent } = renderReview(lang);
      await press(screen.queryByRole("button", { name: w.merge }));
      const dialog = screen.queryByRole("alertdialog");
      await press(dialog ? within(dialog).queryByRole("button", { name: w.write }) : null);
      await settle(() => screen.queryByRole("button", { name: w.accept }) !== null);
      await press(screen.queryByRole("button", { name: w.accept }));
      const field = screen.queryByLabelText(w.message) as HTMLTextAreaElement | null;
      const value = field?.value ?? "no field";
      await press(dialog ? within(dialog).queryByRole("button", { name: w.merge }) : null);
      const run = sent.find(([, type]) => type === "assistant.run")?.[2] as
        | Record<string, unknown>
        | undefined;
      expect([
        run?.kind ?? "no run",
        run?.source ?? "no source",
        value,
        mergeCall(sent)?.message ?? "no message",
      ]).toEqual(["commit.message", SOURCE, MESSAGE, MESSAGE]);
    });
  }

  test("an empty message is not sent: the host keeps its default", async () => {
    const { sent } = renderReview("en");
    await press(screen.queryByRole("button", { name: WORDS.en.merge }));
    const dialog = screen.queryByRole("alertdialog");
    const hasField = screen.queryByLabelText(WORDS.en.message) !== null;
    await press(dialog ? within(dialog).queryByRole("button", { name: WORDS.en.merge }) : null);
    expect([hasField, mergeCall(sent) ? "message" in (mergeCall(sent) ?? {}) : "no merge"]).toEqual(
      [true, false],
    );
  });
});

describe("card-messages-ui: the PR asks for its title and description (#162)", () => {
  for (const lang of ["en", "pt-BR"] as const) {
    const w = WORDS[lang];

    test(`the title and the description each have a wand on the card's repo, and both are confirmed (${lang})`, async () => {
      const { store, sent, t } = setup(lang);
      const confirmed: unknown[][] = [];
      render(
        <TContext.Provider value={t}>
          <TooltipProvider>
            <PrDescriptionDialog
              text="What changed."
              title="Add the login"
              redacted={0}
              assist={{
                controller: store.assistant,
                fieldHostId: "h1",
                source: { kind: "card", cardId: "c1" },
                openSettings: () => {},
              }}
              onConfirm={(...args: unknown[]) => void confirmed.push(args)}
              onCancel={() => {}}
            />
          </TooltipProvider>
        </TContext.Provider>,
      );
      const wands = screen.queryAllByRole("button", { name: w.improve }).length;
      const title = screen.queryByLabelText(w.prTitle) as HTMLInputElement | null;
      expect(title).not.toBeNull();
      await act(async () => {
        fireEvent.change(title as HTMLInputElement, { target: { value: "Add the login page" } });
      });
      await press(screen.queryAllByRole("button", { name: w.improve })[0] ?? null);
      await settle(() => sent.some(([, type]) => type === "assistant.run"));
      const run = sent.find(([, type]) => type === "assistant.run")?.[2] as
        | Record<string, unknown>
        | undefined;
      await press(screen.queryByRole("button", { name: w.open }));
      expect([wands, run?.kind ?? "no run", run?.source ?? "no source", confirmed]).toEqual([
        2,
        "pr.title",
        SOURCE,
        [["What changed.", "Add the login page"]],
      ]);
    });
  }
});

describe("card-messages-ui: a wand with no provider opens Settings (#162)", () => {
  test("the store opens Settings at the assistant's section", () => {
    const store = new AppStore(memoryPlatform(false, "en").platform, { baseDelayMs: 600_000 });
    store.openAssistantSettings();
    expect(store.router.current).toEqual({ name: "settings", section: "assistant" });
  });

  test("the merge's wand, with no provider able to run, sends the person to Settings", async () => {
    const { store, t } = setup("en");
    // An API provider with no key saved: there is nothing to run on.
    store.assistant.setPrefs({ provider: "anthropic" });
    const opened: string[] = [];
    (store as unknown as { openAssistantSettings(): void }).openAssistantSettings = () =>
      void opened.push("settings");
    render(
      <TContext.Provider value={t}>
        <TooltipProvider>
          <CardReview
            store={store}
            hostId="h1"
            card={{ id: "c1", prUrl: null, title: "Add the login" } as never}
            changes={{ base: "main", position: { ahead: 1, behind: 0 } } as never}
            refresh={async () => {}}
          />
        </TooltipProvider>
      </TContext.Provider>,
    );
    await press(screen.queryByRole("button", { name: WORDS.en.merge }));
    const dialog = screen.queryByRole("alertdialog");
    await press(dialog ? within(dialog).queryByRole("button", { name: WORDS.en.write }) : null);
    expect(opened).toEqual(["settings"]);
  });
});
