import { afterEach, describe, expect, setDefaultTimeout, spyOn, test } from "bun:test";
import { settle, stays } from "../wait.ts";
import {
  ANSWER,
  act,
  asked,
  box,
  click,
  fireEvent,
  make,
  render,
  restoreGlobals,
  screen,
  type,
  within,
} from "./wand-setup.tsx";

const { AssistantSettings } = await import("../../src/features/assistant/assistant-settings.tsx");

setDefaultTimeout(30_000);
afterEach(restoreGlobals);
const realSetTimeout = globalThis.setTimeout;

/** Holds back the Undo window (a timer of just under 15 s) so a test runs it by hand; every other timer runs as it is. */
function watchTimers() {
  const held: { run: () => void; delay: number }[] = [];
  globalThis.setTimeout = ((run: () => void, delay?: number, ...rest: unknown[]) => {
    if ((delay ?? 0) <= 14_000 || (delay ?? 0) > 15_000) return realSetTimeout(run, delay, ...rest);
    held.push({ run, delay: delay as number });
    return held.length as unknown as ReturnType<typeof setTimeout>;
  }) as unknown as typeof setTimeout;
  return {
    delays: () => held.map((timer) => timer.delay),
    fire: () => {
      for (const timer of held.splice(0)) timer.run();
    },
  };
}

/** Improve, then Accept the preview: the box holds the proposal and the Undo chip is up. */
async function accepted() {
  await click("Improve with AI");
  const dialog = await screen.findByRole("dialog", { name: "AI suggestion" });
  await act(async () => {
    fireEvent.click(within(dialog).getByRole("button", { name: "Accept" }));
  });
}
describe("assistant-wand-ui: the wand on the message box (issue #158)", () => {
  test("a message box with text offers Improve with AI, with its shortcut, beside the other tools", async () => {
    await make();
    type("fix the totl of the cart");
    const wand = screen.queryByRole("button", { name: "Improve with AI" });
    expect(wand?.getAttribute("aria-keyshortcuts")).toBe("Control+I");
    expect(wand?.hasAttribute("disabled")).toBe(false);
  });

  test("an empty box that cannot be written from nothing is disabled, and says why", async () => {
    await make();
    const wand = screen.queryByRole("button", { name: "Write something first" });
    expect(wand?.hasAttribute("disabled")).toBe(true);
  });

  test("a screen that gives no assistant has no wand", async () => {
    await make({}, { assist: false });
    type("some text");
    expect(screen.queryByRole("button", { name: /with AI/ })).toBeNull();
  });

  test("with Show the wand off there is no wand", async () => {
    const { store } = await make();
    type("some text");
    expect(screen.queryByRole("button", { name: "Improve with AI" })).not.toBeNull();
    await act(async () => store.assistant.setPrefs({ enabled: false }));
    expect(screen.queryByRole("button", { name: /with AI/ })).toBeNull();
  });

  test("a click sends the text, shows it running, then Before and After; the box is unchanged until Accept", async () => {
    let answer: (text: string) => void = () => {};
    const { fake } = await make({
      run: (request) =>
        new Promise((resolve) => {
          answer = (text) => resolve({ ...ANSWER, text, model: request.model });
        }),
    });
    type("fix the totl");
    await click("Improve with AI");
    await settle(() => screen.queryByRole("status") !== null);
    expect(screen.getByRole("button", { name: "Cancel" })).not.toBeNull();
    expect(asked(fake)).toHaveLength(1);
    const request = asked(fake)[0]?.[1] as { kind: string; user: string };
    expect(request.kind).toBe("prompt");
    expect(request.user).toContain("fix the totl");
    await act(async () => answer("Fix the total."));
    const dialog = await screen.findByRole("dialog", { name: "AI suggestion" });
    expect(within(dialog).getByText("fix the totl")).not.toBeNull();
    expect(within(dialog).getByText("Fix the total.")).not.toBeNull();
    // Nothing changes before Accept.
    expect(box().value).toBe("fix the totl");
  });

  test("a text of several lines is shown as one set of changes: what stayed is muted, what was added and removed is marked", async () => {
    await make({ run: () => ({ ...ANSWER, text: "Fix the total.\nAnd the cart." }) });
    type("fix the totl\nand the cart");
    await click("Improve with AI");
    const dialog = await screen.findByRole("dialog", { name: "AI suggestion" });
    const changes = within(dialog).queryByRole("group", { name: "Changes" });
    expect(changes).not.toBeNull();
    const marks = (tag: string) =>
      Array.from((changes as HTMLElement).querySelectorAll(tag)).map((node) => node.textContent);
    expect(marks("del")).toContain("totl");
    expect(marks("ins")).toContain("total.");
    expect(marks("ins")).toContain("And");
    const kept = Array.from((changes as HTMLElement).querySelectorAll("span.text-muted-foreground"))
      .map((node) => node.textContent)
      .join("");
    expect(kept).toContain("the");
    expect(kept).not.toContain("total.");
    expect(within(dialog).queryByText("Before")).toBeNull();
    expect(box().value).toBe("fix the totl\nand the cart");
  });

  test("editing a text of several lines goes back to Before and After, with the After to change", async () => {
    await make({ run: () => ({ ...ANSWER, text: "Fix the total.\nAnd the cart." }) });
    type("fix the totl\nand the cart");
    await click("Improve with AI");
    const dialog = await screen.findByRole("dialog", { name: "AI suggestion" });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Edit" }));
    });
    expect(within(dialog).queryByRole("group", { name: "Changes" })).toBeNull();
    expect(within(dialog).queryByText("Before")).not.toBeNull();
    expect(within(dialog).queryByRole("textbox", { name: "After" })).not.toBeNull();
  });

  test("Accept puts the proposal in the box once and closes the preview", async () => {
    const { fake } = await make();
    type("fix the totl");
    await click("Improve with AI");
    const dialog = await screen.findByRole("dialog", { name: "AI suggestion" });
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Accept" }));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Accept" }));
    });
    expect(box().value).toBe("Fix the total.");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(asked(fake)).toHaveLength(1);
  });

  test("Edit makes After a text to change, and Accept puts the edited text in the box", async () => {
    await make();
    type("fix the totl");
    await click("Improve with AI");
    const dialog = await screen.findByRole("dialog", { name: "AI suggestion" });
    expect(within(dialog).queryByRole("textbox", { name: "After" })).toBeNull();
    const edit = within(dialog).queryByRole("button", { name: "Edit" });
    expect(edit).not.toBeNull();
    await act(async () => {
      fireEvent.click(edit as HTMLElement);
    });
    const edited = within(dialog).queryByRole("textbox", { name: "After" }) as HTMLTextAreaElement;
    expect(edited?.value).toBe("Fix the total.");
    await act(async () => {
      fireEvent.change(edited, { target: { value: "Fix the total of the cart." } });
    });
    // Nothing reaches the box before Accept, edited or not.
    expect(box().value).toBe("fix the totl");
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Accept" }));
    });
    expect(box().value).toBe("Fix the total of the cart.");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("Esc in the edited text discards the preview and leaves the box alone", async () => {
    await make();
    type("fix the totl");
    await click("Improve with AI");
    await click("Edit");
    await act(async () => {
      fireEvent.keyDown(screen.getByRole("textbox", { name: "After" }), { key: "Escape" });
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(box().value).toBe("fix the totl");
  });

  test("Retry sends the same text again and shows the new answer", async () => {
    let n = 0;
    const { fake } = await make({
      run: (request) => ({ ...ANSWER, text: `Answer ${++n}`, model: request.model }),
    });
    type("fix the totl");
    await click("Improve with AI");
    const first = await screen.findByRole("dialog", { name: "AI suggestion" });
    expect(within(first).queryByText("Answer 1")).not.toBeNull();
    await click("Retry");
    await settle(() => screen.queryByText("Answer 2") !== null);
    expect(asked(fake)).toHaveLength(2);
    const sent = asked(fake).map((call) => (call[1] as { user: string }).user);
    expect(sent[1]).toBe(sent[0]);
    expect(box().value).toBe("fix the totl");
  });

  test("Discard and Esc leave the box alone", async () => {
    await make();
    type("fix the totl");
    await click("Improve with AI");
    const dialog = await screen.findByRole("dialog", { name: "AI suggestion" });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Discard" }));
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(box().value).toBe("fix the totl");
    await click("Improve with AI");
    const again = await screen.findByRole("dialog", { name: "AI suggestion" });
    await act(async () => {
      fireEvent.keyDown(again, { key: "Escape" });
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(box().value).toBe("fix the totl");
  });

  test("after Accept an Undo chip puts the old text back and goes away", async () => {
    await make();
    type("fix the totl");
    await accepted();
    expect(screen.queryByText("Text replaced by AI.")).not.toBeNull();
    await click("Undo");
    expect(box().value).toBe("fix the totl");
    expect(screen.queryByText("Text replaced by AI.")).toBeNull();
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  test("Ctrl+Z and Cmd+Z in the box undo the accepted text and are not typed; Shift and a later edit do not", async () => {
    await make();
    type("fix the totl");
    await accepted();
    let notPrevented = true;
    await act(async () => {
      notPrevented = fireEvent.keyDown(box(), { key: "z", ctrlKey: true, shiftKey: true });
    });
    expect(notPrevented).toBe(true);
    expect(box().value).toBe("Fix the total.");
    await act(async () => {
      notPrevented = fireEvent.keyDown(box(), { key: "z", ctrlKey: true });
    });
    expect(notPrevented).toBe(false);
    expect(box().value).toBe("fix the totl");
    expect(screen.queryByText("Text replaced by AI.")).toBeNull();
    await act(async () => {
      notPrevented = fireEvent.keyDown(box(), { key: "z", ctrlKey: true });
    });
    expect(notPrevented).toBe(true);
    await accepted();
    await act(async () => {
      notPrevented = fireEvent.keyDown(box(), { key: "Z", metaKey: true });
    });
    expect(notPrevented).toBe(false);
    expect(box().value).toBe("fix the totl");
  });

  test("typing after Accept drops the chip and Ctrl+Z is left to the browser", async () => {
    await make();
    type("fix the totl");
    await accepted();
    type("Fix the total!");
    expect(screen.queryByText("Text replaced by AI.")).toBeNull();
    let notPrevented = false;
    await act(async () => {
      notPrevented = fireEvent.keyDown(box(), { key: "z", ctrlKey: true });
    });
    expect(notPrevented).toBe(true);
    expect(box().value).toBe("Fix the total!");
  });

  test("the chip goes away on its own once its 15 seconds are over", async () => {
    await make();
    type("fix the totl");
    const timers = watchTimers();
    // Other code sets long timers too (a reconnect, a toast): only the chip's own is held and fired.
    const other = setTimeout(() => {}, 600_000);
    const acceptedAt = Date.now();
    await accepted();
    expect(timers.delays()).toHaveLength(1);
    expect(timers.delays()[0]).toBeGreaterThan(14_000);
    expect(timers.delays()[0]).toBeLessThanOrEqual(15_000);
    expect(screen.queryByText("Text replaced by AI.")).not.toBeNull();
    const spy = spyOn(Date, "now").mockReturnValue(acceptedAt + 16_000);
    await act(async () => timers.fire());
    spy.mockRestore();
    clearTimeout(other);
    expect(screen.queryByText("Text replaced by AI.")).toBeNull();
    expect(box().value).toBe("Fix the total.");
  });

  test("Cancel while it runs stops the request, and a late answer is dropped", async () => {
    let answer: (text: string) => void = () => {};
    const { fake } = await make({
      run: (request) =>
        new Promise((resolve) => {
          answer = (text) => resolve({ ...ANSWER, text, model: request.model });
        }),
    });
    type("fix the totl");
    await click("Improve with AI");
    await click("Cancel");
    expect(fake.calls.filter((c) => c[0] === "cancel")).toHaveLength(1);
    expect(screen.queryByRole("status")).toBeNull();
    await act(async () => answer("Too late."));
    await stays(() => screen.queryByRole("dialog") === null);
    expect(box().value).toBe("fix the totl");
  });

  test("text changed while it ran: the preview says so and Accept asks to go on", async () => {
    let answer: (text: string) => void = () => {};
    await make({
      run: (request) =>
        new Promise((resolve) => {
          answer = (text) => resolve({ ...ANSWER, text, model: request.model });
        }),
    });
    type("fix the totl");
    await click("Improve with AI");
    type("fix the totl of the cart");
    await act(async () => answer("Fix the total."));
    const dialog = await screen.findByRole("dialog", { name: "AI suggestion" });
    expect(within(dialog).getByText("The text changed while this was written.")).not.toBeNull();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Accept anyway" }));
    });
    expect(box().value).toBe("Fix the total.");
  });

  test("Ctrl+I and Cmd+I in the box start the wand and are not typed; IME composition is left alone", async () => {
    const { fake } = await make();
    type("fix the totl");
    const composing = fireEvent.keyDown(box(), { key: "i", ctrlKey: true, isComposing: true });
    expect(composing).toBe(true);
    expect(asked(fake)).toHaveLength(0);
    let notPrevented = true;
    await act(async () => {
      notPrevented = fireEvent.keyDown(box(), { key: "i", ctrlKey: true });
    });
    expect(notPrevented).toBe(false);
    await screen.findByRole("dialog", { name: "AI suggestion" });
    expect(asked(fake)).toHaveLength(1);
    await click("Discard");
    await act(async () => {
      fireEvent.keyDown(box(), { key: "I", metaKey: true });
    });
    await screen.findByRole("dialog", { name: "AI suggestion" });
    expect(asked(fake)).toHaveLength(2);
    // Other keys are the box's.
    expect(fireEvent.keyDown(box(), { key: "i" })).toBe(true);
  });

  test("Esc in the box cancels a run, closes a preview and dismisses a failure", async () => {
    let answer: (text: string) => void = () => {};
    let fail = false;
    const { fake } = await make({
      run: (request) => {
        if (fail) throw { reason: "assistant_credits" };
        return new Promise((resolve) => {
          answer = (text) => resolve({ ...ANSWER, text, model: request.model });
        });
      },
    });
    type("fix the totl");
    await click("Improve with AI");
    await act(async () => {
      fireEvent.keyDown(box(), { key: "Escape" });
    });
    expect(fake.calls.filter((c) => c[0] === "cancel")).toHaveLength(1);
    expect(screen.queryByRole("status")).toBeNull();
    // The cancelled call ends on its own and gives the one run of the app back.
    await act(async () => answer("Too late."));
    await click("Improve with AI");
    await act(async () => answer("Fix the total."));
    await screen.findByRole("dialog", { name: "AI suggestion" });
    await act(async () => {
      fireEvent.keyDown(box(), { key: "Escape" });
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    fail = true;
    await click("Improve with AI");
    await screen.findByRole("alert");
    await act(async () => {
      fireEvent.keyDown(box(), { key: "Escape" });
    });
    expect(screen.queryByRole("alert")).toBeNull();
    // With nothing open, Esc is the box's own.
    expect(fireEvent.keyDown(box(), { key: "Escape" })).toBe(true);
    expect(box().value).toBe("fix the totl");
  });

  test("a Cancel the provider cannot take is not an error: the wand still closes", async () => {
    const { fake } = await make({ run: () => new Promise(() => {}) });
    fake.assistant.cancel = async () => {
      throw { reason: "assistant_offline" };
    };
    type("fix the totl");
    await click("Improve with AI");
    await click("Cancel");
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  test("in a short window the toolbar keeps its room: no button, and Ctrl+I still works", async () => {
    const { fake } = await make({}, { short: true });
    type("fix the totl");
    expect(screen.queryByRole("button", { name: /with AI/ })).toBeNull();
    await act(async () => {
      fireEvent.keyDown(box(), { key: "i", ctrlKey: true });
    });
    await screen.findByRole("dialog", { name: "AI suggestion" });
    expect(asked(fake)).toHaveLength(1);
  });

  test("while another wand holds the one run, this one is disabled and says why", async () => {
    const { store } = await make();
    type("fix the totl");
    await act(async () => void store.assistant.gate.acquire("other"));
    expect(
      screen
        .getByRole("button", { name: "Another AI request is running" })
        .hasAttribute("disabled"),
    ).toBe(true);
    await act(async () => store.assistant.gate.release("other"));
    expect(screen.getByRole("button", { name: "Improve with AI" }).hasAttribute("disabled")).toBe(
      false,
    );
  });

  test("it reads in Portuguese", async () => {
    await make({}, { language: "pt-BR" });
    type("corrige o totl");
    await click("Melhorar com IA");
    const dialog = await screen.findByRole("dialog", { name: "Sugestão da IA" });
    expect(within(dialog).getByRole("button", { name: "Aceitar" })).not.toBeNull();
    expect(within(dialog).queryByRole("button", { name: "Editar" })).not.toBeNull();
    expect(within(dialog).queryByRole("button", { name: "Tentar de novo" })).not.toBeNull();
    expect(within(dialog).getByRole("button", { name: "Descartar" })).not.toBeNull();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Aceitar" }));
    });
    expect(screen.queryByText("Texto trocado pela IA.")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Desfazer" })).not.toBeNull();
  });
});

describe("assistant-wand-ui: Settings says why it opened (issue #158)", () => {
  test("after a wand found no provider, Settings shows the one-line notice once", async () => {
    const { store, t } = await make({}, { configured: false });
    store.assistant.askForSetup();
    const settings = render(<AssistantSettings store={store} t={t} />);
    expect(screen.queryByRole("note")?.textContent).toBe(
      "Choose an AI provider to use the wand on text fields.",
    );
    expect(store.assistant.wantsSetup()).toBe(false);
    settings.unmount();
    render(<AssistantSettings store={store} t={t} />);
    expect(screen.queryByRole("note")).toBeNull();
  });
});

describe("assistant-wand-ui: the preview tells what the answer was checked against (issue #681)", () => {
  const NOTICES = [
    "diff_truncated",
    "lines_redacted",
    "subject_too_long",
    "subject_trailing_period",
    "subject_not_conventional",
    "body_needs_blank_line",
  ];
  const answered = (notices: string[]) => ({
    run: () => ({ ...ANSWER, text: "Fix the total.", notices }),
  });
  const notes = (name: string) => {
    const dialog = screen.queryByRole("dialog", { name: "AI suggestion" });
    const list = dialog ? within(dialog).queryByRole("list", { name }) : null;
    return list ? within(list).queryAllByRole("listitem") : [];
  };

  test("each notice shows in words, beside the suggestion, and Accept still works", async () => {
    await make(answered(NOTICES));
    type("fix the totl");
    await click("Improve with AI");
    await settle(() => screen.queryByRole("dialog", { name: "AI suggestion" }) !== null);
    expect(notes("Notes").map((item) => item.textContent)).toEqual([
      "The diff was too long, so only part of it was read.",
      "Some lines were left out because they looked like secrets.",
      "The first line is longer than 72 characters.",
      "The first line ends with a period.",
      "The repository asks for Conventional Commits: type(scope): text.",
      "Leave a blank line after the first line.",
    ]);
    await click("Accept");
    expect(box().value).toBe("Fix the total.");
  });

  test("a notice the app does not know is not shown as a raw code, and no notice shows no list", async () => {
    await make(answered(["something_new"]));
    type("fix the totl");
    await click("Improve with AI");
    await settle(() => screen.queryByRole("dialog", { name: "AI suggestion" }) !== null);
    expect(notes("Notes")).toHaveLength(0);
    expect(document.body.textContent).not.toContain("something_new");
  });

  test("it reads in Portuguese", async () => {
    await make(answered(["diff_truncated"]), { language: "pt-BR" });
    type("conserte o totl");
    await click("Melhorar com IA");
    await settle(() => screen.queryByRole("dialog", { name: "Sugestão da IA" }) !== null);
    const dialog = screen.getByRole("dialog", { name: "Sugestão da IA" });
    expect(within(dialog).queryByRole("list", { name: "Observações" })).not.toBeNull();
  });
});
