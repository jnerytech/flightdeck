import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { settleMaybe, stays } from "./wait.ts";

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
    workflows?: unknown[] | null;
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
  const retries: unknown[] = [];
  store.hostCommand = (async (
    _hostId: string,
    type: string,
    payload: unknown,
    commandOptions?: { retry?: boolean },
  ) => {
    sent.push([type, payload]);
    retries.push(commandOptions?.retry);
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
        workflows={(options.workflows === undefined ? [WORKFLOW] : options.workflows) as never}
        onOpenCard={(id) => opened.push(id)}
      />
    </TContext.Provider>,
  );
  return { store, sent, recaps, success, opened, retries };
}

const click = (el: Element) =>
  act(async () => {
    fireEvent.click(el);
  });
const button = (name: string) => screen.queryByRole("button", { name });
async function press(name: string) {
  const target = button(name);
  expect(target !== null).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
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
    expect(button("Draft a post-mortem") === null).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
  });

  test("a card with a problem has the button, and a failed run is enough too", () => {
    setup();
    expect(button("Draft a post-mortem") !== null).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
    cleanup();
    setup({
      card: { notice: null },
      run: { workflowName: "feature", status: "failed", statusReason: null, steps: [] },
    });
    expect(button("Draft a post-mortem") !== null).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
  });

  test("the dialog holds the facts of the card and of its session, ready to read and edit", async () => {
    const { recaps } = setup();
    await open();
    expect(dialog("Draft a post-mortem") !== null).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
    expect(recaps).toEqual(["s1"]);
    const text = incident()?.value ?? "";
    expect(text).toContain("Card: Fix the login");
    expect(text).toContain("Problem on the card: The setup script failed.");
    expect(text).toContain("Asked: Fix the login bug");
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
    expect(field !== null).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
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
    expect(dialog("Draft a post-mortem") === null).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
    expect(success.map((s) => s.text)).toEqual(["Post-mortem started: Post-mortem: Fix the login"]);
    success[0]?.open?.();
    expect(opened).toEqual(["new1"]);
  });

  test("a project without the post-mortem workflow says how to get it, and cannot start", async () => {
    const { sent } = setup({ workflows: [] });
    await open();
    expect(screen.queryByText(/draft workflow is not set up in this project/i) !== null).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
    const start = button("Start the post-mortem") as HTMLButtonElement | null;
    expect(start?.disabled).toBe(true);
    expect(sent).toEqual([]);
  });

  test("a refused command is not offered a retry that would make a card without starting it", async () => {
    const { sent, retries } = setup();
    await open();
    await press("Start the post-mortem");
    await settleMaybe(() => sent.length === 2);
    expect(retries).toEqual([false, false]);
  });

  test("a card made but refused a start is said, and Start again only starts that card", async () => {
    const { sent } = setup({ started: false });
    await open();
    await press("Start the post-mortem");
    await settleMaybe(() => sent.length === 2);
    await settleMaybe(() => screen.queryByText(/was made but did not start/) !== null);
    expect(screen.queryByText(/was made but did not start/) !== null).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
    expect(dialog("Draft a post-mortem") !== null).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
    await press("Start the post-mortem");
    await settleMaybe(() => sent.length === 3);
    expect(sent.map(([type]) => type)).toEqual(["card.create", "card.start", "card.start"]);
  });

  test("while the project's workflows are not known yet, it neither warns nor starts", async () => {
    const { sent } = setup({ workflows: null });
    await open();
    expect(screen.queryByText(/workflow is not set up in this project/i) === null).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
    const start = button("Start the post-mortem") as HTMLButtonElement | null;
    expect(start?.disabled).toBe(true);
    expect(sent).toEqual([]);
  });

  test("a card the host refuses to make keeps the dialog and the text, and starts nothing", async () => {
    const { sent, success } = setup({ created: false });
    await open();
    const before = incident()?.value ?? "";
    await press("Start the post-mortem");
    await settleMaybe(() => sent.length === 1);
    await stays(() => sent.length === 1);
    expect(sent.map(([type]) => type)).toEqual(["card.create"]);
    expect(dialog("Draft a post-mortem") !== null).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
    expect(before.length).toBeGreaterThan(0);
    expect(incident()?.value).toBe(before);
    expect(success).toEqual([]);
  });

  test("Escape closes the dialog, sends nothing and gives the focus back", async () => {
    const { sent } = setup();
    await open();
    const shown = dialog("Draft a post-mortem");
    expect(shown !== null).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
    await act(async () => {
      fireEvent.keyDown(shown ?? document.body, { key: "Escape" });
    });
    await settleMaybe(() => dialog("Draft a post-mortem") === null);
    expect(sent).toEqual([]);
    await settleMaybe(() => document.activeElement === button("Draft a post-mortem"));
    expect(document.activeElement === button("Draft a post-mortem")).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
  });

  test("in Portuguese the button, the dialog and the notice follow the language", async () => {
    setup({ language: "pt-BR", workflows: [] });
    await press("Redigir um post-mortem");
    await settleMaybe(() => screen.queryByRole("textbox", { name: "Incidente" }) !== null);
    expect(dialog("Redigir um post-mortem") !== null).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
    expect(screen.queryByText(/não está configurado neste projeto/) !== null).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
    expect(button("Iniciar o post-mortem") !== null).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
  });
});
