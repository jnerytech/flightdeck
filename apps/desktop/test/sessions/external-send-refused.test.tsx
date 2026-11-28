import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { ExternalSession } from "@flightdeck/protocol";
import { registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";
import { settleMaybe } from "../wait.ts";

registerDom();
const { cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { AppStore } = await import("../../src/lib/app-store.ts");
const { ExternalView } = await import("../../src/features/sessions/external-session-view.tsx");
const { TContext } = await import("../../src/i18n/context.tsx");

/** Issue #4502: a message the host refuses comes back to the box of a terminal session. */
setDefaultTimeout(20_000);
afterEach(cleanup);

const ID = "eeeeeeee-0000-4000-8000-000000004502";

type Answer =
  | { ok: true; data: Record<string, never> }
  | { ok: false; code: string; message: string };

/** The view of a controllable terminal session whose host answers every request with `answer`. */
function view(language: "en" | "pt-BR", answer: () => Promise<Answer>) {
  const store = new AppStore(memoryPlatform(false, language).platform, { baseDelayMs: 60_000 });
  store.i18n.start();
  const asked: unknown[] = [];
  (store as unknown as Record<string, unknown>).hostRequest = async (
    _host: string,
    type: string,
    payload: unknown,
  ) => {
    // The transcript reader asks too: it stays loading, so only the message box shows a line.
    if (type !== "external.message") return new Promise(() => {});
    asked.push([type, payload]);
    return answer();
  };
  const session: ExternalSession = {
    claudeSessionId: ID,
    cwd: "/work/api",
    transcriptPath: null,
    source: "startup",
    status: "idle",
    statusReason: null,
    launchId: null,
    controllable: true,
    projectKey: null,
    startedAt: "2026-11-28T10:00:00.000Z",
    lastEventAt: "2026-11-28T10:00:00.000Z",
    endedAt: null,
  };
  const state = { ...store.getState(), externals: { [`h1/${ID}`]: session } };
  render(
    <TContext.Provider value={store.i18n.t}>
      <ExternalView
        store={store}
        state={state}
        hostId="h1"
        hostName="pc"
        claudeSessionId={ID}
        onResumed={() => {}}
      />
    </TContext.Provider>,
  );
  return { asked, t: store.i18n.t };
}

const refused = async (): Promise<Answer> => ({
  ok: false,
  code: "offline",
  message: "host is off",
});
const taken = async (): Promise<Answer> => ({ ok: true, data: {} });

/** The message box of the view, whose label is the dictionary's. */
const box = (label: string) => screen.getByLabelText(label) as HTMLTextAreaElement;

const type = (label: string, text: string) =>
  fireEvent.change(box(label), { target: { value: text } });

describe("external-send-refused: a refused message is not lost (#4502)", () => {
  test("a refusal puts the text back in the box and says it was not sent", async () => {
    const { asked, t } = view("en", refused);
    type(t("external.message"), "  run the tests  ");
    fireEvent.click(screen.getByRole("button", { name: t("external.send") }));
    const back = await settleMaybe(() => box(t("external.message")).value === "run the tests");
    const line = screen.queryByText("Not sent: the message is back in the box.");
    expect(back).toBe(true);
    expect(line?.getAttribute("role") ?? "").toBe("alert");
    expect(asked).toEqual([["external.message", { claudeSessionId: ID, text: "run the tests" }]]);
  });

  test("the line reads in pt-BR too", async () => {
    const { t } = view("pt-BR", refused);
    type(t("external.message"), "rode os testes");
    fireEvent.click(screen.getByRole("button", { name: t("external.send") }));
    const text = "Não enviada: a mensagem voltou para a caixa.";
    const shown = await settleMaybe(() => screen.queryByText(text) !== null);
    expect(shown).toBe(true);
    expect(screen.queryByText(text)?.getAttribute("role") ?? "").toBe("alert");
  });

  test("what was typed while it was sent stays after the returned text", async () => {
    let finish: (a: Answer) => void = () => {};
    const { t } = view(
      "en",
      () =>
        new Promise<Answer>((resolve) => {
          finish = resolve;
        }),
    );
    type(t("external.message"), "first");
    fireEvent.click(screen.getByRole("button", { name: t("external.send") }));
    type(t("external.message"), "second");
    finish({ ok: false, code: "offline", message: "host is off" });
    const merged = await settleMaybe(() => box(t("external.message")).value === "first\n\nsecond");
    expect(merged).toBe(true);
  });

  test("an accepted message leaves the box empty and no line", async () => {
    const { asked, t } = view("en", taken);
    type(t("external.message"), "hello");
    fireEvent.click(screen.getByRole("button", { name: t("external.send") }));
    const sent = await settleMaybe(() => asked.length === 1);
    expect(sent).toBe(true);
    expect(box(t("external.message")).value).toBe("");
    expect(screen.queryByText("Not sent: the message is back in the box.")).toBeNull();
  });

  test("Send with an empty box moves the focus into the box and sends nothing", async () => {
    const { asked, t } = view("en", taken);
    const send = screen.getByRole("button", { name: t("external.send") });
    send.focus();
    fireEvent.click(send);
    const inBox = document.activeElement === box(t("external.message"));
    expect(inBox).toBe(true);
    expect(asked).toEqual([]);
  });
});
