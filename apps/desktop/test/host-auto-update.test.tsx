import { afterEach, describe, expect, test } from "bun:test";
import { en } from "../src/i18n/en.ts";
import { translator } from "../src/i18n/index.ts";
import { ptBR } from "../src/i18n/pt-BR.ts";
import { liveScreen, registerDom } from "./dom.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { HostAutoUpdate } = await import("../src/components/hosts/host-auto-update.tsx");

afterEach(() => cleanup());

type Status = {
  enabled: boolean;
  state: "off" | "current" | "waiting" | "started" | "failed";
  version?: string;
  reason?: string;
};

/** A host whose daemon offers the automatic update with `status`, and a store that records the switch. */
function show(lang: "en" | "pt-BR", status: Status | undefined, features = ["autoUpdate"]) {
  const sent: unknown[] = [];
  const store = {
    i18n: { t: translator(lang) },
    hostCommand: async (_host: string, command: string, payload: { auto: boolean }) => {
      sent.push([command, payload]);
      return { enabled: payload.auto, state: payload.auto ? "current" : "off" };
    },
  } as never;
  const host = {
    id: "h",
    name: "pc",
    status: "online",
    hostInfo: { features, ...(status ? { autoUpdate: status } : {}) },
  } as never;
  render(<HostAutoUpdate store={store} host={host} />);
  return sent;
}

const fill = (text: string, vars: Record<string, string>) =>
  Object.entries(vars).reduce((s, [k, v]) => s.replace(`{${k}}`, v), text);

for (const [lang, dict] of [
  ["en", en],
  ["pt-BR", ptBR],
] as const) {
  describe(`host-auto-update (${lang}): the host page's automatic update (issue #280)`, () => {
    test("the switch shows the host's choice and turning it off is sent to the host", async () => {
      const sent = show(lang, { enabled: true, state: "current" });
      const box = screen.queryByRole("checkbox", { name: dict.hostAutoUpdate.label });
      expect(box).not.toBeNull();
      expect((box as HTMLInputElement).checked).toBe(true);
      expect(screen.queryByText(dict.hostAutoUpdate.current)).not.toBeNull();
      await act(async () => {
        fireEvent.click(box as HTMLElement);
      });
      expect(sent).toEqual([["host.updates.set", { auto: false }]]);
      expect((box as HTMLInputElement).checked).toBe(false);
      expect(screen.queryByText(dict.hostAutoUpdate.off)).not.toBeNull();
    });

    test("an update waiting for the host to be idle, one started and one that failed each say so", () => {
      show(lang, { enabled: true, state: "waiting", version: "0.38.0" });
      expect(
        screen.queryByText(fill(dict.hostAutoUpdate.waiting, { version: "0.38.0" })),
      ).not.toBeNull();
      cleanup();
      show(lang, { enabled: true, state: "started", version: "0.38.0" });
      expect(
        screen.queryByText(fill(dict.hostAutoUpdate.started, { version: "0.38.0" })),
      ).not.toBeNull();
      cleanup();
      show(lang, { enabled: true, state: "failed", version: "0.38.0", reason: "bad signature" });
      expect(
        screen.queryByText(
          fill(dict.hostAutoUpdate.failed, { version: "0.38.0", reason: "bad signature" }),
        ),
      ).not.toBeNull();
    });

    test("a host without the feature shows nothing", () => {
      show(lang, undefined, []);
      expect(screen.queryByRole("checkbox", { name: dict.hostAutoUpdate.label })).toBeNull();
    });
  });
}
