import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { formatPairingLink } from "@flightdeck/protocol";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

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
    submit: "Test and add",
    missing: "fill in name, address, port and token",
  },
  "pt-BR": {
    steps: "Primeiros passos",
    byHand: "Informar o endereço e o token manualmente",
    link: "Link de pareamento",
    name: "Nome",
    copySetup: "Copiar flightdeckd setup",
    copyDoctor: "Copiar flightdeckd doctor",
    submit: "Testar e adicionar",
    missing: "preencha nome, endereço, porta e token",
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
  await act(() => store.addHost({ name: "one", url: server.url, token: TOKEN }));
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
      for (const [name, command] of [
        [text.copySetup, "flightdeckd setup"],
        [text.copyDoctor, "flightdeckd doctor"],
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
  }
});
