import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { settleMaybe } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { TContext } = await import("../src/i18n/context.tsx");
const { PostMortem } = await import("../src/components/card/post-mortem.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

const CARD = {
  id: "c1",
  projectId: "p1",
  title: "Fix the login",
  description: "",
  notice: "The setup script failed.",
  prUrl: null,
};
const WORKFLOW = { name: "post-mortem", inputs: ["incident"], trusted: true, errors: [] };
const RECAP = {
  asked: "Fix the login bug",
  done: "Changed auth.ts",
  files: ["auth.ts"],
  filesMore: 0,
  costUsd: null,
  question: null,
  state: "idle",
  source: "transcript",
};

function setup(
  options: {
    language?: "en" | "pt-BR";
    card?: Record<string, unknown>;
    run?: Record<string, unknown> | null;
    workflows?: unknown[];
    claudeSessionId?: string | null;
    created?: boolean;
    started?: boolean;
  } = {},
) {
  const store = new AppStore(memoryPlatform(false, options.language ?? "en").platform, {
    baseDelayMs: 600_000,
  });
  store.i18n.start();
  const sent: Array<[string, unknown]> = [];
  const recaps: string[] = [];
  const success: Array<{ text: string; open: (() => void) | undefined }> = [];
  const opened: string[] = [];
  store.hostCommand = (async (_hostId: string, type: string, payload: unknown) => {
    sent.push([type, payload]);
    if (type === "card.create") {
      return options.created === false ? null : { id: "new1", title: "Post-mortem: Fix the login" };
    }
    if (type === "card.start") return options.started === false ? null : { id: "new1" };
    return null;
  }) as never;
  store.sessionRecap = (async (_hostId: string, id: string) => {
    recaps.push(id);
    return RECAP;
  }) as never;
  store.success = ((text: string, link?: { run: () => void }) => {
    success.push({ text, open: link?.run });
  }) as never;
  render(
    <TContext.Provider value={store.i18n.t}>
      <PostMortem
        store={store}
        hostId="h1"
        card={{ ...CARD, ...options.card } as never}
        run={(options.run ?? null) as never}
        claudeSessionId={options.claudeSessionId === undefined ? "s1" : options.claudeSessionId}
        workflows={(options.workflows ?? [WORKFLOW]) as never}
        onOpenCard={(id) => opened.push(id)}
      />
    </TContext.Provider>,
  );
  return { store, sent, recaps, success, opened };
}

const click = (el: Element) =>
  act(async () => {
    fireEvent.click(el);
  });
const button = (name: string) => screen.queryByRole("button", { name });
async function press(name: string) {
  const target = button(name);
  expect(target !== null).toBe(true);
  if (target) await click(target);
}
const dialog = (name: string) => screen.queryByRole("dialog", { name });
const incident = () =>
  screen.queryByRole("textbox", { name: "Incident" }) as HTMLTextAreaElement | null;

async function open() {
  await press("Draft a post-mortem");
  await settleMaybe(() => incident() !== null);
}

describe("Draft a post-mortem from a failed card (issue #79)", () => {
  test("a card that did not fail has no button", () => {
    setup({ card: { notice: null } });
    expect(button("Draft a post-mortem") === null).toBe(true);
  });

  test("a card with a problem has the button, and a failed run is enough too", () => {
    setup();
    expect(button("Draft a post-mortem") !== null).toBe(true);
    cleanup();
    setup({
      card: { notice: null },
      run: { workflowName: "feature", status: "failed", statusReason: null, steps: [] },
    });
    expect(button("Draft a post-mortem") !== null).toBe(true);
  });

  test("the dialog holds the facts of the card and of its session, ready to read and edit", async () => {
    const { recaps } = setup();
    await open();
    expect(dialog("Draft a post-mortem") !== null).toBe(true);
    expect(recaps).toEqual(["s1"]);
    const text = incident()?.value ?? "";
    expect(text.includes("Card: Fix the login")).toBe(true);
    expect(text.includes("Problem on the card: The setup script failed.")).toBe(true);
    expect(text.includes("Asked: Fix the login bug")).toBe(true);
  });

  test("a card with no session still gives the facts it has, and asks for no summary", async () => {
    const { recaps } = setup({ claudeSessionId: null });
    await open();
    expect(recaps).toEqual([]);
    expect(incident()?.value).toBe(
      "Card: Fix the login\nProblem on the card: The setup script failed.",
    );
  });

  test("Start makes a new card and starts it with the post-mortem workflow and the edited text", async () => {
    const { sent, success, opened } = setup();
    await open();
    const field = incident();
    expect(field !== null).toBe(true);
    if (field) {
      await act(async () => {
        fireEvent.change(field, { target: { value: "My edited incident" } });
      });
    }
    await press("Start the post-mortem");
    await settleMaybe(() => sent.length === 2);
    expect(sent).toEqual([
      ["card.create", { projectId: "p1", title: "Post-mortem: Fix the login", description: "" }],
      [
        "card.start",
        { cardId: "new1", workflow: "post-mortem", inputs: { incident: "My edited incident" } },
      ],
    ]);
    await settleMaybe(() => dialog("Draft a post-mortem") === null);
    expect(success.map((s) => s.text)).toEqual(["Post-mortem started: Post-mortem: Fix the login"]);
    success[0]?.open?.();
    expect(opened).toEqual(["new1"]);
  });

  test("a project without the post-mortem workflow says how to get it, and cannot start", async () => {
    const { sent } = setup({ workflows: [] });
    await open();
    expect(screen.queryByText(/Draft workflow is not set up in this project/) !== null).toBe(true);
    const start = button("Start the post-mortem") as HTMLButtonElement | null;
    expect(start?.disabled).toBe(true);
    expect(sent).toEqual([]);
  });

  test("a card the host refuses to make keeps the dialog and the text, and starts nothing", async () => {
    const { sent, success } = setup({ created: false });
    await open();
    await press("Start the post-mortem");
    await settleMaybe(() => sent.length === 1);
    expect(sent.map(([type]) => type)).toEqual(["card.create"]);
    expect(dialog("Draft a post-mortem") !== null).toBe(true);
    expect((incident()?.value ?? "").length > 0).toBe(true);
    expect(success).toEqual([]);
  });

  test("Escape closes the dialog, sends nothing and gives the focus back", async () => {
    const { sent } = setup();
    await open();
    const shown = dialog("Draft a post-mortem");
    expect(shown !== null).toBe(true);
    await act(async () => {
      fireEvent.keyDown(shown ?? document.body, { key: "Escape" });
    });
    await settleMaybe(() => dialog("Draft a post-mortem") === null);
    expect(sent).toEqual([]);
    await settleMaybe(() => document.activeElement === button("Draft a post-mortem"));
    expect(document.activeElement === button("Draft a post-mortem")).toBe(true);
  });

  test("in Portuguese the button, the dialog and the notice follow the language", async () => {
    setup({ language: "pt-BR", workflows: [] });
    await press("Redigir um post-mortem");
    await settleMaybe(() => screen.queryByRole("textbox", { name: "Incidente" }) !== null);
    expect(dialog("Redigir um post-mortem") !== null).toBe(true);
    expect(screen.queryByText(/não está configurado neste projeto/) !== null).toBe(true);
    expect(button("Iniciar o post-mortem") !== null).toBe(true);
  });
});
