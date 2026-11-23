import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { formatPairingLink } from "@flightdeck/protocol";
import { liveScreen, registerDom } from "../dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "../fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { App } = await import("../../src/app/App.tsx");

setDefaultTimeout(30_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const TEXT = {
  en: {
    steps: "First steps",
    byHand: "Enter the address and token by hand",
    link: "Pairing link",
    name: "Name",
    copySetup: "Copy flightdeckd setup",
    copyDoctor: "Copy flightdeckd doctor",
    copyPair: "Copy flightdeckd pair",
    lost: "Lost the link? Run this on that computer and copy the new one:",
    submit: "Test and add",
    missing: "Fill in the name.",
    address: "Address",
    token: "Token",
    taken: "Another host, one, already has this name.",
  },
  "pt-BR": {
    steps: "Primeiros passos",
    byHand: "Informar o endereço e o token manualmente",
    link: "Link de pareamento",
    name: "Nome",
    copySetup: "Copiar flightdeckd setup",
    copyDoctor: "Copiar flightdeckd doctor",
    copyPair: "Copiar flightdeckd pair",
    lost: "Perdeu o link? No mesmo computador, rode o comando abaixo e copie o novo:",
    submit: "Testar e adicionar",
    missing: "Preencha o nome.",
    address: "Endereço",
    token: "Token",
    taken: "Outro host, one, já tem esse nome.",
  },
} as const;

/** The Add a host page of an app that already has one host: the case the guide was missing from. */
async function secondHostPage(language: keyof typeof TEXT) {
  const first = makeDaemon(cleanups);
  const server = first.listen();
  const copies: string[] = [];
  const mem = memoryPlatform(false, language);
  const platform = {
    ...mem.platform,
    copyText: async (text: string) => {
      copies.push(text);
    },
  };
  const store = new AppStore(platform, { baseDelayMs: 10 });
  cleanups.push(() => store.dispose());
  render(<App store={store} />);
  await act(() => store.roster.add({ name: "one", url: server.url, token: TOKEN }));
  await act(async () => {
    store.tabs.active.router.push({ name: "add-host" });
  });
  return { copies, text: TEXT[language] };
}

/** The fold around the manual fields, found by its summary. */
const fold = (summary: string): HTMLDetailsElement | null =>
  screen.queryByText(summary)?.closest("details") ?? null;

describe("host-guide: Add a host (issue #1199)", () => {
  for (const language of ["en", "pt-BR"] as const) {
    test(`${language}: with a host already added, the page lists the first-run steps with their copy buttons`, async () => {
      const { copies, text } = await secondHostPage(language);
      const list = screen.queryByRole("list", { name: text.steps });
      expect(list).not.toBeNull();
      expect(within(list as HTMLElement).queryAllByRole("listitem")).toHaveLength(4);
      expect(screen.queryByText(text.lost)).not.toBeNull();
      // #4386: setup is run from the downloaded file, so step 1 has no copy button for it.
      expect(screen.queryByRole("button", { name: text.copySetup })).toBeNull();
      for (const [name, command] of [
        [text.copyDoctor, "flightdeckd doctor"],
        [text.copyPair, "flightdeckd pair"],
      ] as const) {
        const copy = screen.queryByRole("button", { name });
        expect(copy).not.toBeNull();
        await act(async () => {
          fireEvent.click(copy as HTMLElement);
        });
        expect(copies.at(-1)).toBe(command);
      }
    });

    test(`${language}: the pairing link stays in view, and the four manual fields fold under one summary`, async () => {
      const { text } = await secondHostPage(language);
      const manual = fold(text.byHand);
      expect(manual).not.toBeNull();
      expect(manual?.open).toBe(false);
      expect(manual?.contains(screen.queryByLabelText(text.name))).toBe(true);
      const link = screen.queryByLabelText(text.link);
      expect(link).not.toBeNull();
      expect(manual?.contains(link)).toBe(false);
    });

    test(`${language}: a pasted pairing link opens the fold on the filled fields`, async () => {
      const { text } = await secondHostPage(language);
      fireEvent.change(screen.queryByLabelText(text.link) as HTMLElement, {
        target: {
          value: formatPairingLink({
            address: "100.64.0.9",
            port: 7421,
            name: "orange pi",
            token: "abc",
          }),
        },
      });
      expect(fold(text.byHand)?.open).toBe(true);
      expect((screen.queryByLabelText(text.name) as HTMLInputElement).value).toBe("orange pi");
    });

    test(`${language}: pressing the button with the fields empty opens the fold on the error`, async () => {
      const { text } = await secondHostPage(language);
      await act(async () => {
        fireEvent.click(screen.queryByRole("button", { name: text.submit }) as HTMLElement);
      });
      expect(fold(text.byHand)?.open).toBe(true);
      expect(screen.queryByText(text.missing)).not.toBeNull();
    });

    test(`${language}: a name the listed host already has is refused on the page before any test (#3884)`, async () => {
      const { text } = await secondHostPage(language);
      for (const [label, value] of [
        [text.name, "ONE"],
        [text.address, "100.64.0.9"],
        [text.token, "abc"],
      ] as const) {
        await act(async () => {
          fireEvent.change(screen.queryByLabelText(label) as HTMLElement, { target: { value } });
        });
      }
      await act(async () => {
        fireEvent.click(screen.queryByRole("button", { name: text.submit }) as HTMLElement);
      });
      expect(screen.queryByText(text.taken)).not.toBeNull();
    });

    test(`${language}: the same error twice opens a fold the person closed in between`, async () => {
      const { text } = await secondHostPage(language);
      const press = () =>
        act(async () => {
          fireEvent.click(screen.queryByRole("button", { name: text.submit }) as HTMLElement);
        });
      await press();
      const manual = fold(text.byHand) as HTMLDetailsElement;
      expect(manual.open).toBe(true);
      await act(async () => {
        manual.open = false;
        manual.dispatchEvent(new Event("toggle"));
      });
      expect(fold(text.byHand)?.open).toBe(false);
      await press();
      expect(fold(text.byHand)?.open).toBe(true);
    });
  }
});
