import { afterEach, describe, expect, test } from "bun:test";
import { translator } from "../../src/i18n/index.ts";
import { liveScreen, registerDom } from "../dom.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { TContext } = await import("../../src/i18n/context.tsx");
const { AlwaysAllow } = await import("../../src/features/permissions/always-allow.tsx");

afterEach(() => cleanup());

/** The "Always in this project" editor of a Bash request, in `lang`, with the rules it sent. */
function editor(lang: "en" | "pt-BR" = "en") {
  const sent: unknown[][] = [];
  render(
    <TContext.Provider value={translator(lang)}>
      <AlwaysAllow
        toolName="Bash"
        input={{ command: "npm test" }}
        suggestions={undefined}
        cwd="/p"
        onAllow={(updates) => sent.push(updates)}
      />
    </TContext.Provider>,
  );
  return sent;
}

const OPEN = { en: "Always in this project", "pt-BR": "Sempre neste projeto" };
const field = (label = "Rule") => screen.queryByLabelText(label) as HTMLInputElement | null;
const button = (name: string) => screen.queryByRole("button", { name }) as HTMLButtonElement | null;

const open = async (lang: "en" | "pt-BR" = "en") => {
  const opener = button(OPEN[lang]);
  expect(opener).not.toBeNull();
  await act(async () => {
    fireEvent.click(opener as HTMLElement);
  });
};
const type = async (value: string, label = "Rule") => {
  expect(field(label)).not.toBeNull();
  await act(async () => {
    fireEvent.change(field(label) as HTMLInputElement, { target: { value } });
  });
};
const enter = async (label = "Rule") => {
  expect(field(label)).not.toBeNull();
  await act(async () => {
    // The form is what Enter submits; with none, the event reaches nobody and the rule is not sent.
    const input = field(label) as HTMLInputElement;
    fireEvent.submit(input.closest("form") ?? input);
  });
};

describe("always-allow editor: the person's way through the rule field (#4158)", () => {
  test("opening the editor puts the focus in the rule field", async () => {
    editor();
    await open();
    expect(field() !== null && document.activeElement === field()).toBe(true);
  });

  test("Enter in the rule field sends the rule once, as Save rule does", async () => {
    const sent = editor();
    await open();
    await type("Bash(npm test:*)");
    await enter();
    expect(sent).toEqual([
      [
        {
          type: "addRules",
          rules: [{ toolName: "Bash", ruleContent: "npm test:*" }],
          behavior: "allow",
          destination: "localSettings",
        },
      ],
    ]);
  });

  test("an empty field disables Save rule and says why", async () => {
    editor();
    await open();
    await type("");
    expect({
      disabled: button("Save rule")?.disabled,
      reason: screen.queryByText("Type a rule to save it.") !== null,
    }).toEqual({ disabled: true, reason: true });
  });

  test("a field of only spaces sends nothing on Enter and leaves Save rule disabled", async () => {
    const sent = editor();
    await open();
    await type("   ");
    await enter();
    expect({ sent, disabled: button("Save rule")?.disabled }).toEqual({ sent: [], disabled: true });
  });

  test("Cancel closes the editor and the focus goes to Always in this project", async () => {
    editor();
    await open();
    await act(async () => {
      fireEvent.click(button("Cancel") as HTMLElement);
    });
    const opener = button(OPEN.en);
    expect({
      closed: field() === null,
      focused: opener !== null && document.activeElement === opener,
    }).toEqual({ closed: true, focused: true });
  });

  test("in pt-BR the reason is in Portuguese", async () => {
    editor("pt-BR");
    await open("pt-BR");
    await type("", "Regra");
    expect(screen.queryByText("Digite uma regra para salvá-la.") !== null).toBe(true);
  });
});
