import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";
import { fakeHostStore } from "../fake-host.ts";
import { settleMaybe } from "../wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { TeamsPage } = await import("../../src/features/teams/page.tsx");
const { TooltipProvider } = await import("../../src/components/ui/tooltip.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

const WORDS = {
  en: {
    field: "Message to everyone",
    send: "Send to everyone",
    sent: (delivered: number, refused: number) => `${delivered} delivered, ${refused} refused`,
  },
  "pt-BR": {
    field: "Mensagem para todos",
    send: "Mandar a todos",
    sent: (delivered: number, refused: number) => `${delivered} entregues, ${refused} recusadas`,
  },
};

/**
 * #2648: the message to everyone on a team sat in a row, not a form, so Enter did nothing, the
 * text stayed after it was sent and the field kept a fixed width. `result` is what the host
 * answers to `teams.message`.
 */
async function openTeam(
  language: "en" | "pt-BR",
  result: { delivered: number; refused: number },
  held: Promise<void> = Promise.resolve(),
) {
  const messages: Array<{ team: string; text: string }> = [];
  const host = await fakeHostStore(
    {
      "teams.list": () => ({
        teams: [
          {
            id: "t1",
            name: "login",
            projectId: "p1",
            state: "active",
            goal: "ship it",
            members: [],
          },
        ],
      }),
      "teams.message": async (payload: { team: string; text: string }) => {
        messages.push(payload);
        await held;
        return result;
      },
    },
    { hostId: "h1", features: ["teams"], language, fallback: null },
  );
  host.store.i18n.start();
  host.store.projectList.load = async () => null;
  render(
    <TooltipProvider>
      <TeamsPage store={host.store} go={() => {}} />
    </TooltipProvider>,
  );
  const words = WORDS[language];
  await settleMaybe(() => screen.queryByLabelText(words.field) !== null, 3000);
  const field = screen.getByLabelText(words.field) as HTMLInputElement;
  return { words, field, messages };
}

const type = (field: HTMLInputElement, value: string) =>
  act(async () => {
    fireEvent.change(field, { target: { value } });
  });

/** Enter in a text field submits its form: the test submits the form and says so when there is none. */
async function submit(field: HTMLInputElement) {
  const form = field.closest("form");
  expect(form !== null).toBe(true);
  if (!form) return;
  await act(async () => {
    fireEvent.submit(form);
  });
}

describe.each(["en", "pt-BR"] as const)("teams-message-all (%s)", (language) => {
  test("the message field and its button are one form", async () => {
    const { field, words } = await openTeam(language, { delivered: 1, refused: 0 });
    const form = field.closest("form");
    expect(form !== null).toBe(true);
    expect(form?.contains(screen.getByRole("button", { name: words.send }))).toBe(true);
  });

  test("Enter in the field sends the text to the team", async () => {
    const { field, messages } = await openTeam(language, { delivered: 2, refused: 0 });
    await type(field, "stand up");
    await submit(field);
    await settleMaybe(() => messages.length === 1, 3000);
    expect(messages).toEqual([{ team: "t1", text: "stand up" }]);
  });

  test("Enter in an empty field sends nothing", async () => {
    const { field, messages, words } = await openTeam(language, { delivered: 1, refused: 0 });
    await type(field, "   ");
    await submit(field);
    expect(messages).toEqual([]);
    expect(screen.queryByText(words.sent(1, 0)) !== null).toBe(false);
  });

  test("the text is cleared once a worker took it, and the outcome line stays", async () => {
    const { field, words, messages } = await openTeam(language, { delivered: 2, refused: 1 });
    await type(field, "stand up");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: words.send }));
    });
    await settleMaybe(() => messages.length === 1, 3000);
    await settleMaybe(() => screen.queryByText(words.sent(2, 1)) !== null, 3000);
    expect(screen.queryByText(words.sent(2, 1)) !== null).toBe(true);
    expect(field.value).toBe("");
  });

  test("the text stays when every worker refused it, so it can be sent again", async () => {
    const { field, words, messages } = await openTeam(language, { delivered: 0, refused: 2 });
    await type(field, "stand up");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: words.send }));
    });
    await settleMaybe(() => messages.length === 1, 3000);
    await settleMaybe(() => screen.queryByText(words.sent(0, 2)) !== null, 3000);
    expect(screen.queryByText(words.sent(0, 2)) !== null).toBe(true);
    expect(field.value).toBe("stand up");
  });

  test("a second Enter before the host answers sends nothing more", async () => {
    let answer = () => {};
    const held = new Promise<void>((resolve) => {
      answer = resolve;
    });
    const { field, messages } = await openTeam(language, { delivered: 1, refused: 0 }, held);
    await type(field, "stand up");
    await submit(field);
    await submit(field);
    answer();
    await settleMaybe(() => messages.length >= 1, 3000);
    expect(messages.length).toBe(1);
  });

  test("a text every worker refused is announced as an alert, not as a calm status", async () => {
    const { words } = await openTeam(language, { delivered: 0, refused: 2 });
    await type(screen.getByLabelText(words.field) as HTMLInputElement, "stand up");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: words.send }));
    });
    await settleMaybe(() => screen.queryByText(words.sent(0, 2)) !== null, 3000);
    const line = screen.getByText(words.sent(0, 2));
    expect(line.closest("[role=alert]") !== null).toBe(true);
  });

  test("the field has no fixed width, so it fills a narrow window", async () => {
    const { field } = await openTeam(language, { delivered: 1, refused: 0 });
    expect(field.className.split(/\s+/).includes("w-64")).toBe(false);
  });
});
