import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { Card } from "@flightdeck/protocol";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

registerDom();
const { act, cleanup, render, waitFor, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { CardFields } = await import("../src/components/card/card-fields.tsx");
const { TContext } = await import("../src/i18n/context.tsx");
const { en } = await import("../src/i18n/en.ts");
const { ptBR } = await import("../src/i18n/pt-BR.ts");

setDefaultTimeout(30_000);
afterEach(cleanup);

/**
 * Issue #1058, slice 2: the validation note field shows the project's own template as its
 * placeholder when the host has one, and says why when a template there was not used. Never saved.
 */
const OURS = "What I ran:\n\nWhat I saw:\n";
const card = {
  id: "c1",
  title: "Cart screen",
  description: "",
  validationNote: null,
  specPath: null,
  slug: "cart-screen",
  worktreePath: null,
} as unknown as Card;

type Answer = { text: string | null; ignored: string | null };

function show(answer: Answer, language: "en" | "pt-BR" = "en") {
  const store = new AppStore(memoryPlatform(false, language).platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  const sent: Array<[string, unknown]> = [];
  store.hostCommand = (async (_host: string, type: string, payload: unknown) => {
    sent.push([type, payload]);
    return type === "card.validationTemplate" ? answer : null;
  }) as never;
  const view = (
    <TContext.Provider value={store.i18n.t}>
      <CardFields store={store} hostId="h1" card={card} withRoi={false} onOpenSettings={() => {}} />
    </TContext.Provider>
  );
  return { view, sent };
}

const field = (label: string) => screen.getByLabelText(label) as HTMLTextAreaElement;

describe("card-validation-template-ui: the project's own validation note shape (#1058)", () => {
  test("a project template is the field's placeholder, asked for by card, and nothing is saved", async () => {
    const { view, sent } = show({ text: OURS, ignored: null });
    render(view);
    await waitFor(() => expect(field("Validation note").placeholder).toBe(OURS));
    const save = screen.getByRole("button", { name: "Save validation note" }) as HTMLButtonElement;
    expect([
      field("Validation note").value,
      save.disabled,
      sent.some(([type]) => type === "card.update"),
      sent.find(([type]) => type === "card.validationTemplate")?.[1],
    ]).toEqual(["", true, false, { cardId: "c1" }]);
  });

  test("with no template the built-in shape stays, and nothing is said", async () => {
    const { view, sent } = show({ text: null, ignored: null });
    render(view);
    await act(async () => {
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(sent.some(([type]) => type === "card.validationTemplate")).toBe(true),
    );
    expect(field("Validation note").placeholder).toBe(en.cardUi.validationShape);
    expect(screen.queryByText(/validation note template was not used/)).toBeNull();
  });

  test("a template that was ignored is named with its reason, in both languages, and the built-in shape stays", async () => {
    const said: string[] = [];
    for (const [language, reason, text] of [
      [
        "en",
        "untrusted",
        "The project's validation note template was not used: the project is not trusted.",
      ],
      [
        "en",
        "unsafe",
        "The project's validation note template was not used: it is a link or has more than one name.",
      ],
      ["en", "too_big", "The project's validation note template was not used: it is over 32 KiB."],
      ["en", "empty", "The project's validation note template was not used: it is empty."],
      [
        "pt-BR",
        "too_big",
        "O modelo de nota de validação do projeto não foi usado: passa de 32 KiB.",
      ],
    ] as const) {
      const { view } = show({ text: null, ignored: reason }, language);
      render(view);
      await waitFor(() => expect(screen.queryByText(text)).not.toBeNull());
      const words = language === "en" ? en : ptBR;
      said.push(
        `${language}/${reason}/${field(words.cardUi.validation).placeholder === words.cardUi.validationShape}`,
      );
      cleanup();
    }
    expect(said).toEqual([
      "en/untrusted/true",
      "en/unsafe/true",
      "en/too_big/true",
      "en/empty/true",
      "pt-BR/too_big/true",
    ]);
  });
});
