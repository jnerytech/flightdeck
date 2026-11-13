import { afterEach, describe, expect, test } from "bun:test";
import { en } from "../../src/i18n/en.ts";
import { translator } from "../../src/i18n/index.ts";
import { ptBR } from "../../src/i18n/pt-BR.ts";
import { liveScreen, registerDom } from "../dom.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { TContext } = await import("../../src/i18n/context.tsx");
const { HostForm } = await import("../../src/features/hosts/host-form.tsx");

afterEach(cleanup);

/** What each refused field says, in plain words that name it (issue #2585). */
const SAYS = {
  en: {
    name: "Fill in the name.",
    address: "Fill in the address.",
    token: "Fill in the token.",
    port: "The port must be a number from 1 to 65535.",
  },
  "pt-BR": {
    name: "Preencha o nome.",
    address: "Preencha o endereço.",
    token: "Preencha o token.",
    port: "A porta deve ser um número de 1 a 65535.",
  },
} as const;

function form(lang: "en" | "pt-BR", error: string | null = null) {
  const submitted: unknown[] = [];
  const ui = (error: string | null) => (
    <TContext.Provider value={translator(lang)}>
      <HostForm error={error} onSubmit={(draft) => submitted.push(draft)} />
    </TContext.Provider>
  );
  const view = render(ui(error));
  return { submitted, again: (next: string | null) => view.rerender(ui(next)) };
}

async function submit(label: string) {
  await act(async () => {
    fireEvent.click(screen.queryByRole("button", { name: label }) as HTMLElement);
  });
}

/** The text a control's aria-describedby points to. */
function described(control: HTMLElement | null): string {
  const ids = control?.getAttribute("aria-describedby")?.split(" ") ?? [];
  return ids.map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
}

for (const [lang, t] of [
  ["en", en],
  ["pt-BR", ptBR],
] as const) {
  const says = SAYS[lang];
  const field = (label: string) => screen.queryByLabelText(label) as HTMLInputElement | null;
  const fill = async (label: string, value: string) => {
    await act(async () => {
      fireEvent.change(field(label) as HTMLElement, { target: { value } });
    });
  };
  const invalid = (label: string) => field(label)?.getAttribute("aria-invalid") === "true";

  describe(`host-form-errors (${lang}): a refused field says what is wrong with it (issue #2585)`, () => {
    test("each empty field is marked and names itself in its own message", async () => {
      form(lang);
      await submit(t.hostForm.submit);
      expect([invalid(t.hostForm.name), described(field(t.hostForm.name))]).toEqual([
        true,
        says.name,
      ]);
      expect([invalid(t.hostForm.address), described(field(t.hostForm.address))]).toEqual([
        true,
        says.address,
      ]);
      expect([invalid(t.hostForm.token), described(field(t.hostForm.token))]).toEqual([
        true,
        says.token,
      ]);
      expect(invalid(t.hostForm.port)).toBe(false);
    });

    test("a field that is filled in is not marked", async () => {
      form(lang);
      await fill(t.hostForm.name, "pc");
      await submit(t.hostForm.submit);
      expect(invalid(t.hostForm.name)).toBe(false);
      expect(invalid(t.hostForm.address)).toBe(true);
    });

    test("a port that is not a number from 1 to 65535 marks the port only", async () => {
      const page = form(lang);
      await fill(t.hostForm.name, "pc");
      await fill(t.hostForm.address, "127.0.0.1");
      await fill(t.hostForm.token, "abc");
      await fill(t.hostForm.port, "99999");
      await submit(t.hostForm.submit);
      expect([invalid(t.hostForm.port), described(field(t.hostForm.port))]).toEqual([
        true,
        says.port,
      ]);
      expect(invalid(t.hostForm.name)).toBe(false);
      expect(page.submitted).toEqual([]);
    });

    test("a refused submit puts the focus on the first field with an error", async () => {
      form(lang);
      await fill(t.hostForm.name, "pc");
      await submit(t.hostForm.submit);
      // A boolean: a failed diff of two DOM nodes can take gigabytes.
      expect(document.activeElement === field(t.hostForm.address)).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
    });

    test("editing a field clears its own error and leaves the others", async () => {
      form(lang);
      await submit(t.hostForm.submit);
      await fill(t.hostForm.name, "p");
      expect(invalid(t.hostForm.name)).toBe(false);
      expect(screen.queryByText(says.name) === null).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
      expect(invalid(t.hostForm.address)).toBe(true);
      expect(screen.queryByText(says.address)).not.toBeNull();
    });

    test("a form that is complete is sent with no error on any field", async () => {
      const page = form(lang);
      await fill(t.hostForm.name, "pc");
      await fill(t.hostForm.address, "127.0.0.1");
      await fill(t.hostForm.token, "abc");
      await submit(t.hostForm.submit);
      expect(page.submitted.length).toBe(1);
      expect(
        invalid(t.hostForm.name) || invalid(t.hostForm.address) || invalid(t.hostForm.token),
      ).toBe(false);
    });
  });

  describe(`host-form-errors (${lang}): the result of the connection test`, () => {
    test("an error of the test stays in one alert line and marks no field", () => {
      form(lang, t.hostForm.probeUnreachable);
      expect(screen.queryAllByText(t.hostForm.probeUnreachable).length).toBe(1);
      expect(screen.queryByRole("alert")?.textContent).toBe(t.hostForm.probeUnreachable);
      expect(invalid(t.hostForm.token)).toBe(false);
    });

    test("a refused token marks the token field and is said once, there", () => {
      form(lang, t.hostForm.probeRefused);
      expect(invalid(t.hostForm.token)).toBe(true);
      expect(described(field(t.hostForm.token))).toBe(t.hostForm.probeRefused);
      expect(screen.queryAllByText(t.hostForm.probeRefused).length).toBe(1);
    });

    test("pasting a link that carries a token answers the refused one", async () => {
      form(lang, t.hostForm.probeRefused);
      await fill(t.hostForm.link, "flightdeck://127.0.0.1:46507?name=alfa&token=fresh-token");
      expect(invalid(t.hostForm.token)).toBe(false);
    });

    test("a submit the form itself refuses does not bring the refused-token mark back", async () => {
      form(lang, t.hostForm.probeRefused);
      await fill(t.hostForm.name, "pc");
      await fill(t.hostForm.address, "127.0.0.1");
      await fill(t.hostForm.token, "new");
      await fill(t.hostForm.port, "99999");
      await submit(t.hostForm.submit);
      expect([invalid(t.hostForm.token), invalid(t.hostForm.port)]).toEqual([false, true]);
    });

    test("pasting a link that fills the fields clears their 'fill in' marks", async () => {
      form(lang);
      await submit(t.hostForm.submit);
      expect(invalid(t.hostForm.name)).toBe(true);
      await fill(t.hostForm.link, "flightdeck://127.0.0.1:46507?name=alfa&token=fresh-token");
      expect([
        invalid(t.hostForm.name),
        invalid(t.hostForm.address),
        invalid(t.hostForm.token),
      ]).toEqual([false, false, false]);
    });

    test("editing the refused token clears that mark", async () => {
      form(lang, t.hostForm.probeRefused);
      await fill(t.hostForm.token, "new");
      expect(invalid(t.hostForm.token)).toBe(false);
      expect(screen.queryByText(t.hostForm.probeRefused) === null).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
    });
  });
}
