import { afterEach, describe, expect, test } from "bun:test";
import { en } from "../src/i18n/en.ts";
import { translator } from "../src/i18n/index.ts";
import { ptBR } from "../src/i18n/pt-BR.ts";
import { liveScreen, registerDom } from "./dom.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { cleanup, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { HostVersionLine } = await import("../src/components/hosts/host-version.tsx");

afterEach(() => cleanup());

for (const [lang, dict] of [
  ["en", en],
  ["pt-BR", ptBR],
] as const) {
  const t = translator(lang);
  const daemon = (version: string) => dict.hostPage.daemon.replace("{version}", version);

  describe(`host-version (${lang}): the host page header says the daemon's version (issue #281)`, () => {
    test("the address and the daemon's version, with no mark when it is the app's", () => {
      render(<HostVersionLine url="ws://pc:7878/v1/ws" daemon="0.37.0" app="0.37.0" t={t} />);
      const line = document.body.textContent ?? "";
      expect(line).toContain("ws://pc:7878/v1/ws");
      expect(line).toContain(daemon("0.37.0"));
      expect(line).not.toContain(dict.hostPage.differs);
    });

    test("a daemon on another version is marked, in words and not by color alone", () => {
      render(<HostVersionLine url="ws://pc:7878/v1/ws" daemon="0.36.4" app="0.37.0" t={t} />);
      expect(screen.queryByText(dict.hostPage.differs)).not.toBeNull();
      expect((document.body.textContent ?? "").includes(daemon("0.36.4"))).toBe(true);
    });

    test("before the host has said its version, only the address shows", () => {
      render(<HostVersionLine url="ws://pc:7878/v1/ws" daemon={null} app="0.37.0" t={t} />);
      expect(document.body.textContent).toBe("ws://pc:7878/v1/ws");
    });
  });
}
